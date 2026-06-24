use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};

use libghostty_vt::render::{CellIterator, RenderState, RowIterator};
use libghostty_vt::screen::{CellWide, Screen};
use libghostty_vt::style::{RgbColor, Underline};
use libghostty_vt::{Terminal, TerminalOptions};

use super::types::{
    GhosttyVtRenderSnapshot, GhosttyVtRenderSnapshotCell, GhosttyVtRenderSnapshotCursor,
};

const DEFAULT_MAX_SCROLLBACK: usize = 10_000;
const CELL_WIDTH_PX: u32 = 8;
const CELL_HEIGHT_PX: u32 = 16;

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

    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        self.terminal
            .resize(cols, rows, CELL_WIDTH_PX, CELL_HEIGHT_PX)
            .map_err(|error| error.to_string())
    }

    pub fn snapshot(&mut self) -> Result<GhosttyVtRenderSnapshot, String> {
        let is_alt_screen = matches!(
            self.terminal
                .active_screen()
                .map_err(|error| error.to_string())?,
            Screen::Alternate
        );
        // Scrollback is meaningless on the alt screen (full-screen TUIs own their
        // own scrolling), so suppress the count there — matching the JS bridge.
        let scrollback_row_count = if is_alt_screen {
            None
        } else {
            let count = self
                .terminal
                .scrollback_rows()
                .map_err(|error| error.to_string())? as u32;
            (count > 0).then_some(count)
        };

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

                    append_row_text(&mut row_text, current_column, &text);

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
            scrollback_row_count,
            is_alt_screen: is_alt_screen.then_some(true),
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

fn append_row_text(row_text: &mut String, column: u16, text: &str) {
    if text.is_empty() {
        return;
    }

    let target = usize::from(column);
    if row_text.len() < target {
        row_text.push_str(&" ".repeat(target - row_text.len()));
    }
    row_text.push_str(text);
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
    fn snapshot_reports_scrollback_row_count_on_the_primary_screen() {
        let mut state = make_state(80, 3);
        fill_past_viewport(&mut state);

        let snapshot = state.snapshot().expect("snapshot");

        assert!(
            snapshot.scrollback_row_count.unwrap_or(0) > 0,
            "rows scrolled past a 3-row viewport must report scrollback"
        );
        assert_eq!(snapshot.is_alt_screen, None, "primary screen is not alt");
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
    fn snapshot_suppresses_scrollback_on_the_alternate_screen() {
        let mut state = make_state(80, 3);
        fill_past_viewport(&mut state);
        state.write(b"\x1b[?1049h").expect("enter alt screen");

        let snapshot = state.snapshot().expect("snapshot");

        assert_eq!(snapshot.is_alt_screen, Some(true), "alt screen is active");
        assert_eq!(
            snapshot.scrollback_row_count, None,
            "scrollback is meaningless on the alt screen"
        );
    }
}
