use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};

use libghostty_vt::render::{CellIterator, RenderState, RowIterator};
use libghostty_vt::screen::{CellWide, Screen};
use libghostty_vt::style::{RgbColor, Underline};
use libghostty_vt::terminal::{Mode, ScrollViewport};
use libghostty_vt::{Terminal, TerminalOptions};

use super::types::{
    GhosttyVtRenderSnapshot, GhosttyVtRenderSnapshotCell, GhosttyVtRenderSnapshotCursor,
};

const DEFAULT_MAX_SCROLLBACK: usize = 10_000;
const CELL_WIDTH_PX: u32 = 8;
const CELL_HEIGHT_PX: u32 = 16;

/// Result of a one-shot feed-and-render `write`. Used only by the test suite
/// (the production read loop uses the decoupled `feed`/`render`/`scroll` path);
/// kept because many tests drive the terminal through a single `write` call.
/// The fields carry the rendered snapshot + cwd for tests that need them; tests
/// that only need the side effect discard the result, so allow the dead fields.
#[cfg(test)]
#[allow(dead_code)]
#[derive(Debug)]
pub(crate) struct GhosttyWriteResult {
    pub snapshot: GhosttyVtRenderSnapshot,
    pub cwd_uri: Option<String>,
}

#[derive(Debug)]
pub(crate) struct GhosttySessionHandle {
    latest_snapshot: Arc<Mutex<Option<GhosttyVtRenderSnapshot>>>,
    resize_tx: Sender<GhosttyResize>,
}

impl Clone for GhosttySessionHandle {
    fn clone(&self) -> Self {
        Self {
            latest_snapshot: Arc::clone(&self.latest_snapshot),
            resize_tx: self.resize_tx.clone(),
        }
    }
}

impl GhosttySessionHandle {
    pub fn new() -> (Self, GhosttySessionReader) {
        let latest_snapshot = Arc::new(Mutex::new(None));
        let (resize_tx, resize_rx) = channel();

        (
            Self {
                latest_snapshot: Arc::clone(&latest_snapshot),
                resize_tx,
            },
            GhosttySessionReader {
                latest_snapshot,
                resize_rx,
            },
        )
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.resize_tx
            .send(GhosttyResize { cols, rows })
            .map_err(|error| error.to_string())
    }

    pub fn latest_snapshot(&self) -> Option<GhosttyVtRenderSnapshot> {
        self.latest_snapshot
            .lock()
            .ok()
            .and_then(|snapshot| snapshot.clone())
    }
}

#[derive(Debug)]
pub(crate) struct GhosttySessionReader {
    latest_snapshot: Arc<Mutex<Option<GhosttyVtRenderSnapshot>>>,
    resize_rx: Receiver<GhosttyResize>,
}

impl GhosttySessionReader {
    pub fn create_state(self, cols: u16, rows: u16) -> Result<GhosttyTerminalState, String> {
        GhosttyTerminalState::new(cols, rows, self)
    }
}

#[derive(Debug)]
struct GhosttyResize {
    cols: u16,
    rows: u16,
}


#[derive(Debug)]
pub(crate) struct GhosttyTerminalState {
    terminal: Terminal<'static, 'static>,
    render_state: RenderState<'static>,
    row_iterator: RowIterator<'static>,
    cell_iterator: CellIterator<'static>,
    latest_cwd_uri: Arc<Mutex<Option<String>>>,
    latest_snapshot: Arc<Mutex<Option<GhosttyVtRenderSnapshot>>>,
    resize_rx: Receiver<GhosttyResize>,
}

impl GhosttyTerminalState {
    fn new(cols: u16, rows: u16, reader: GhosttySessionReader) -> Result<Self, String> {
        let latest_cwd_uri = Arc::new(Mutex::new(None));
        let latest_cwd_uri_for_callback = Arc::clone(&latest_cwd_uri);
        let mut terminal = Terminal::new(TerminalOptions {
            cols,
            rows,
            max_scrollback: DEFAULT_MAX_SCROLLBACK,
        })
        .map_err(|error| error.to_string())?;

        terminal
            .on_pwd_changed(move |terminal| {
                if let Ok(uri) = terminal.pwd() {
                    if let Ok(mut latest) = latest_cwd_uri_for_callback.lock() {
                        *latest = Some(uri.to_string());
                    }
                }
            })
            .map_err(|error| error.to_string())?;

        Ok(Self {
            terminal,
            render_state: RenderState::new().map_err(|error| error.to_string())?,
            row_iterator: RowIterator::new().map_err(|error| error.to_string())?,
            cell_iterator: CellIterator::new().map_err(|error| error.to_string())?,
            latest_cwd_uri,
            latest_snapshot: reader.latest_snapshot,
            resize_rx: reader.resize_rx,
        })
    }

    /// One-shot feed-and-render used by the test suite to drive the terminal
    /// through a single call. Production uses the decoupled `feed`/`render`/
    /// `scroll` path (the coalescing read loop), so this is test-only.
    #[cfg(test)]
    pub fn write(&mut self, bytes: &[u8]) -> Result<GhosttyWriteResult, String> {
        self.apply_pending_resize()?;
        self.terminal.vt_write(bytes);
        let snapshot = self.snapshot()?;
        self.publish_snapshot(snapshot.clone());

        Ok(GhosttyWriteResult {
            snapshot,
            cwd_uri: self.take_cwd_uri(),
        })
    }

    /// Feed bytes to the VT engine WITHOUT producing a snapshot. Cheap (just
    /// parses into the grid). The coalescing read loop feeds a whole burst this
    /// way, then renders one snapshot per frame interval — decoupling VT
    /// processing from rendering the way Ghostty does, so a flood of small
    /// chunks (e.g. codex re-rendering its transcript on resume) doesn't become
    /// a per-chunk frame storm.
    pub(crate) fn feed(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.apply_pending_resize()?;
        self.terminal.vt_write(bytes);
        Ok(())
    }

    /// Render the current terminal state into a snapshot and publish it for
    /// reattach. Returns the snapshot plus any pending OSC 7 cwd change. Paired
    /// with `feed`: feed a burst, render once.
    pub(crate) fn render(&mut self) -> Result<(GhosttyVtRenderSnapshot, Option<String>), String> {
        let snapshot = self.snapshot()?;
        self.publish_snapshot(snapshot.clone());
        Ok((snapshot, self.take_cwd_uri()))
    }

    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        self.terminal
            .resize(cols, rows, CELL_WIDTH_PX, CELL_HEIGHT_PX)
            .map_err(|error| error.to_string())
    }

    /// Engine-driven scroll: move the viewport by `delta` rows (negative scrolls
    /// up into history) and return a fresh snapshot at the new position. The
    /// engine renders any scroll position authoritatively — including codex/kimi
    /// primary-screen repaints — so the snapshot IS the scrollback view; no
    /// separate scrollback store is needed. New output keeps the scroll position
    /// (sticky scroll) and follows the live tail only when pinned to the bottom.
    pub(crate) fn scroll(&mut self, delta: i32) -> Result<GhosttyVtRenderSnapshot, String> {
        // Negative scrolls up into history; a large magnitude clamps at the
        // top/bottom, so a big positive delta resumes auto-follow at the tail.
        self.terminal
            .scroll_viewport(ScrollViewport::Delta(delta as isize));
        self.snapshot()
    }

    pub fn snapshot(&mut self) -> Result<GhosttyVtRenderSnapshot, String> {
        let is_alt_screen = matches!(
            self.terminal
                .active_screen()
                .map_err(|error| error.to_string())?,
            Screen::Alternate
        );

        // Wheel-forwarding gate (VIM-223): apps that track the mouse want real
        // wheel events forwarded as encoded mouse-event bytes instead of the
        // engine scrolling the viewport. SGR (1006) vs legacy X10 framing
        // selects how those bytes are framed.
        let is_mouse_tracking = self.terminal.is_mouse_tracking().unwrap_or(false);
        let is_sgr_mouse = self.terminal.mode(Mode::SGR_MOUSE).unwrap_or(false);

        let snapshot = self
            .render_state
            .update(&self.terminal)
            .map_err(|error| error.to_string())?;
        let row_count = usize::from(snapshot.rows().map_err(|error| error.to_string())?);
        let cursor = snapshot
            .cursor_viewport()
            .map_err(|error| error.to_string())?
            .map(|cursor| GhosttyVtRenderSnapshotCursor {
                row_index: cursor.y,
                column_offset: cursor.x,
                visible: snapshot.cursor_visible().ok(),
            });
        let mut rows = Vec::with_capacity(row_count);
        let mut cells = Vec::new();
        let mut row_iteration = self
            .row_iterator
            .update(&snapshot)
            .map_err(|error| error.to_string())?;

        while let Some(row) = row_iteration.next() {
            let row_index = rows.len() as u16;
            let mut row_text = String::new();
            // Display columns currently materialised in `row_text`. Tracked
            // explicitly (not via byte length) so blank-column gaps left by
            // multi-byte glyphs stay aligned with the sparse cells.
            let mut row_columns = 0u16;
            let mut current_column = 0u16;
            let mut cell_iteration = self
                .cell_iterator
                .update(row)
                .map_err(|error| error.to_string())?;

            while let Some(cell) = cell_iteration.next() {
                let raw_cell = cell.raw_cell().map_err(|error| error.to_string())?;
                let wide = raw_cell.wide().map_err(|error| error.to_string())?;
                let cell_width = match wide {
                    CellWide::Wide => 2,
                    CellWide::Narrow | CellWide::SpacerTail | CellWide::SpacerHead => 1,
                };

                if !matches!(wide, CellWide::SpacerTail | CellWide::SpacerHead) {
                    let mut text = String::new();
                    cell.graphemes_utf8(&mut text)
                        .map_err(|error| error.to_string())?;

                    append_row_text(
                        &mut row_text,
                        &mut row_columns,
                        current_column,
                        cell_width,
                        &text,
                    );

                    let style = cell.style().map_err(|error| error.to_string())?;
                    let foreground = cell
                        .fg_color()
                        .map_err(|error| error.to_string())?
                        .map(format_color);
                    let background = cell
                        .bg_color()
                        .map_err(|error| error.to_string())?
                        .map(format_color);

                    if !text.is_empty()
                        || style.bold
                        || style.italic
                        || style.underline != Underline::None
                        || style.inverse
                        || foreground.is_some()
                        || background.is_some()
                    {
                        cells.push(GhosttyVtRenderSnapshotCell {
                            row: row_index,
                            col: current_column,
                            text,
                            width: cell_width,
                            bold: style.bold.then_some(true),
                            italic: style.italic.then_some(true),
                            underline: (style.underline != Underline::None).then_some(true),
                            foreground,
                            background,
                            reverse: style.inverse.then_some(true),
                        });
                    }
                }

                current_column = current_column.saturating_add(1);
            }

            trim_trailing_spaces(&mut row_text);
            rows.push(row_text);
        }

        while rows.len() < row_count {
            rows.push(String::new());
        }

        Ok(GhosttyVtRenderSnapshot {
            rows,
            cursor,
            cells: (!cells.is_empty()).then_some(cells),
            is_alt_screen: is_alt_screen.then_some(true),
            is_mouse_tracking: is_mouse_tracking.then_some(true),
            is_sgr_mouse: is_sgr_mouse.then_some(true),
        })
    }

    fn take_cwd_uri(&self) -> Option<String> {
        self.latest_cwd_uri
            .lock()
            .ok()
            .and_then(|mut latest| latest.take())
    }

    fn apply_pending_resize(&mut self) -> Result<(), String> {
        while let Ok(resize) = self.resize_rx.try_recv() {
            self.resize(resize.cols, resize.rows)?;
        }

        Ok(())
    }

    fn publish_snapshot(&self, snapshot: GhosttyVtRenderSnapshot) {
        if let Ok(mut latest) = self.latest_snapshot.lock() {
            *latest = Some(snapshot);
        }
    }
}

/// Append a cell's text at its grid `column`, padding any blank-column gap with
/// spaces so `row_text`'s display columns stay aligned with the (sparse) cells.
///
/// `row_columns` tracks how many display columns `row_text` already spans. It
/// must be measured in columns, not bytes: a glyph like `•` (U+2022) is three
/// UTF-8 bytes but one column, so a byte-based gap calculation under-pads and
/// the frontend's gap-fill then duplicates the next styled run's first char.
fn append_row_text(
    row_text: &mut String,
    row_columns: &mut u16,
    column: u16,
    width: u16,
    text: &str,
) {
    if text.is_empty() {
        return;
    }

    if *row_columns < column {
        row_text.push_str(&" ".repeat(usize::from(column - *row_columns)));
        *row_columns = column;
    }
    row_text.push_str(text);
    *row_columns = row_columns.saturating_add(width);
}

fn trim_trailing_spaces(value: &mut String) {
    let trimmed_len = value.trim_end_matches(' ').len();
    value.truncate(trimmed_len);
}

fn format_color(color: RgbColor) -> String {
    format!("#{:02x}{:02x}{:02x}", color.r, color.g, color.b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_state(cols: u16, rows: u16) -> GhosttyTerminalState {
        let (_handle, reader) = GhosttySessionHandle::new();
        reader
            .create_state(cols, rows)
            .expect("create ghostty terminal state")
    }

    fn fill_past_viewport(state: &mut GhosttyTerminalState) {
        for index in 0..12 {
            state
                .write(format!("line {index}\r\n").as_bytes())
                .expect("write line");
        }
    }

    #[test]
    fn snapshot_reports_no_alt_screen_flag_on_the_primary_screen() {
        let mut state = make_state(80, 3);
        fill_past_viewport(&mut state);

        let snapshot = state.snapshot().expect("snapshot");

        assert_eq!(snapshot.is_alt_screen, None, "primary screen is not alt");
    }

    #[test]
    fn row_text_stays_column_aligned_across_a_multibyte_prefix_gap() {
        // A bullet (U+2022 — 3 bytes, 1 column) then the cursor jumps one column
        // ahead, leaving a blank column before styled text. This is exactly how
        // codex/claude position text when they treat such glyphs as wide. The
        // rowText must keep the blank column (a space) so its column offsets stay
        // aligned with the sparse cells; otherwise the frontend's gap-fill reads
        // the wrong rowText offset and duplicates the styled run's first char.
        let mut state = make_state(80, 24);
        state
            .write(b"\xe2\x80\xa2\x1b[3G\x1b[1mStart\x1b[0m")
            .expect("write");
        let snapshot = state.snapshot().expect("snap");

        let s_cell = snapshot
            .cells
            .iter()
            .flatten()
            .find(|c| c.text == "S")
            .expect("the S cell");
        assert_eq!(
            snapshot.rows[0].chars().nth(usize::from(s_cell.col)),
            Some('S'),
            "rowText {:?} is not column-aligned with the S cell at col {}",
            snapshot.rows[0],
            s_cell.col
        );
    }

    #[test]
    fn snapshot_captures_alt_screen_styled_content_with_resolved_colors() {
        // A coding-agent TUI draws a styled box on the alt screen. The snapshot
        // must carry the text AND resolve the ANSI colors to RGB hex — the Rust
        // engine is where agent color/text fidelity is proven.
        let mut state = make_state(80, 24);
        state
            .write(b"\x1b[?1049h\x1b[H\x1b[44;37m box \x1b[0m")
            .expect("write alt box");

        let snapshot = state.snapshot().expect("snapshot");

        assert_eq!(snapshot.is_alt_screen, Some(true));
        assert!(
            snapshot.rows.iter().any(|row| row.contains("box")),
            "alt-screen text must be captured"
        );
        let styled = snapshot
            .cells
            .as_ref()
            .expect("alt-screen styled cells")
            .iter()
            .find(|cell| cell.text == "b")
            .expect("the 'b' cell");
        assert!(
            styled.foreground.is_some() && styled.background.is_some(),
            "ANSI colors must resolve to RGB hex, got fg={:?} bg={:?}",
            styled.foreground,
            styled.background
        );
    }

    #[test]
    fn snapshot_reports_wheel_forwarding_modes() {
        let mut state = make_state(80, 24);
        // Mouse tracking (1000) + SGR mouse (1006).
        state
            .write(b"\x1b[?1000h\x1b[?1006h")
            .expect("write modes on");
        let snapshot = state.snapshot().expect("snapshot");
        assert_eq!(snapshot.is_mouse_tracking, Some(true), "mouse tracking on");
        assert_eq!(snapshot.is_sgr_mouse, Some(true), "sgr mouse on");

        // Disabling them clears the flags (None, not Some(false)).
        state
            .write(b"\x1b[?1000l\x1b[?1006l")
            .expect("write modes off");
        let snapshot = state.snapshot().expect("snapshot");
        assert_eq!(snapshot.is_mouse_tracking, None, "mouse tracking off");
        assert_eq!(snapshot.is_sgr_mouse, None, "sgr mouse off");
    }

    #[test]
    fn scroll_viewport_moves_the_snapshot_into_history() {
        // SPIKE (engine-driven scroll): scroll_viewport(Delta(up)) must move the
        // viewport into scrollback so the very next render snapshot shows the
        // scrolled-up history rows. This is the entire basis of the redesign:
        // the engine renders any scroll position, no separate store needed.
        let mut state = make_state(80, 3);
        fill_past_viewport(&mut state); // writes line 0..=11; viewport shows the tail

        let before = state.snapshot().expect("snapshot at bottom");
        assert!(
            !before.rows.iter().any(|r| r.contains("line 0")),
            "viewport at bottom must NOT show the earliest line, got {:?}",
            before.rows
        );

        // A relative up-scroll lands on earlier history (engine renders it).
        state
            .terminal
            .scroll_viewport(libghostty_vt::terminal::ScrollViewport::Delta(-8));
        let after_delta = state.snapshot().expect("snapshot after delta scroll");
        assert!(
            after_delta.rows.iter().all(|r| !r.contains("line 11")),
            "an up-scroll must leave the live tail off-screen, got {:?}",
            after_delta.rows
        );

        // Scrolling to the very top deterministically surfaces the earliest line.
        state
            .terminal
            .scroll_viewport(libghostty_vt::terminal::ScrollViewport::Top);
        let after = state.snapshot().expect("snapshot after scroll to top");
        assert!(
            after.rows.iter().any(|r| r.contains("line 0")),
            "scrolling to the top must show the earliest history row, got {:?}",
            after.rows
        );

        // New output while scrolled up STAYS at the scroll position (sticky
        // scroll) — the engine does not yank to the live tail. This is the UX we
        // want, and it means auto-follow needs no explicit handling: the engine
        // follows the bottom only when the viewport is pinned there. (We are
        // scrolled to the TOP showing "line 0" here.)
        state.write(b"freshline\r\n").expect("write while scrolled up");
        let after_write = state.snapshot().expect("snapshot after write while scrolled");
        assert!(
            after_write.rows.iter().any(|r| r.contains("line 0")),
            "new output while scrolled up must keep the scroll position, got {:?}",
            after_write.rows
        );
        assert!(
            after_write.rows.iter().all(|r| !r.contains("freshline")),
            "new output while scrolled up must NOT yank to the live tail, got {:?}",
            after_write.rows
        );

        // And scrolling back to the bottom returns to the live tail (auto-follow).
        state
            .terminal
            .scroll_viewport(libghostty_vt::terminal::ScrollViewport::Bottom);
        let back = state.snapshot().expect("snapshot back at bottom");
        assert!(
            !back.rows.iter().any(|r| r.contains("line 0")),
            "scrolling back to bottom must leave history off-screen, got {:?}",
            back.rows
        );
    }

    #[test]
    fn scroll_method_renders_history_through_a_row_delta() {
        // The state's `scroll` wrapper (driven over the command→read-thread
        // channel by a signed row delta) must render history like the raw engine,
        // and a large delta clamps at the top/bottom.
        let mut state = make_state(80, 3);
        fill_past_viewport(&mut state);

        let up = state.scroll(-1000).expect("scroll up (clamps to top)");
        assert!(
            up.rows.iter().any(|r| r.contains("line 0")),
            "a large up-delta must surface the earliest history row, got {:?}",
            up.rows
        );

        let down = state.scroll(1000).expect("scroll down (clamps to tail)");
        assert!(
            down.rows.iter().all(|r| !r.contains("line 0")),
            "a large down-delta must return to the live tail, got {:?}",
            down.rows
        );
    }

    #[test]
    fn resize_grows_the_snapshot_row_count() {
        // A taller terminal must produce a taller snapshot — otherwise agents
        // that fill the pane (codex/kimi) would be truncated to the initial
        // 24-row viewport even after the pane grows.
        let mut state = make_state(80, 24);
        let before = state.snapshot().expect("snapshot at 24 rows");
        assert_eq!(before.rows.len(), 24, "initial viewport should be 24 rows");

        state.resize(80, 40).expect("resize to 40 rows");
        for index in 0..40 {
            state
                .write(format!("row {index}\r\n").as_bytes())
                .expect("write row");
        }
        let after = state.snapshot().expect("snapshot at 40 rows");
        assert_eq!(
            after.rows.len(),
            40,
            "a resized viewport must report 40 rows, got {}",
            after.rows.len()
        );
    }
}
