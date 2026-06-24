use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};

use libghostty_vt::render::{CellIterator, RenderState, RowIterator};
use libghostty_vt::screen::{CellContentTag, CellWide, Screen};
use libghostty_vt::style::{RgbColor, StyleColor, Underline};
use libghostty_vt::terminal::{Point, PointCoordinate};
use libghostty_vt::{Terminal, TerminalOptions};

use super::types::{
    GhosttyVtRenderSnapshot, GhosttyVtRenderSnapshotCell, GhosttyVtRenderSnapshotCursor,
    GhosttyVtScrollback,
};

const DEFAULT_MAX_SCROLLBACK: usize = 10_000;
const CELL_WIDTH_PX: u32 = 8;
const CELL_HEIGHT_PX: u32 = 16;

/// Compile-time `Send` assertion used by [`_scrollback_store_is_send`].
fn _assert_send<T: Send>() {}

/// Compile-time guard: the scrollback store — and the handle that carries it —
/// must hold only `Send` data. The lazy-fetch design depends on a command
/// handler reading the store on-demand WITHOUT touching the `!Send` libghostty
/// `Terminal` (parked on a blocking PTY read on its own thread). If this fails
/// to compile, the store grew a non-`Send` field and the design is broken.
#[allow(dead_code)]
fn _scrollback_store_is_send() {
    _assert_send::<ScrollbackStore>();
    _assert_send::<GhosttySessionHandle>();
}

/// One stored scrollback row: its column-aligned plain text plus the styled
/// cells belonging to that row. Plain owned data (`String` + `Vec` of `Clone`
/// cells) so the whole store is `Send`.
#[derive(Clone, Debug)]
struct StoredScrollbackRow {
    text: String,
    cells: Vec<GhosttyVtRenderSnapshotCell>,
}

/// The `Send` history buffer the read thread fills (via `write`'s evicted-row
/// delta) and a command handler drains on scroll-up. Replaces the eager
/// per-frame snapshot delta with a lazy windowed fetch: history accumulates
/// here, capped at [`DEFAULT_MAX_SCROLLBACK`] rows (front-evicted), and the
/// frontend pulls `[start, start + count)` slices on demand.
#[derive(Default, Debug)]
pub(crate) struct ScrollbackStore {
    rows: std::collections::VecDeque<StoredScrollbackRow>,
}

impl ScrollbackStore {
    /// Append one frame's worth of newly-evicted scrollback. The incoming
    /// `cells` are grouped by their `row` field (the 0-based index WITHIN the
    /// delta) onto the matching `rows[i]`, producing one [`StoredScrollbackRow`]
    /// per delta row. Once the buffer exceeds the cap, the oldest rows are
    /// evicted from the FRONT so the store tracks the most-recent history.
    fn append(&mut self, scrollback: GhosttyVtScrollback) {
        let mut per_row: Vec<Vec<GhosttyVtRenderSnapshotCell>> =
            vec![Vec::new(); scrollback.rows.len()];
        for cell in scrollback.cells {
            if let Some(bucket) = per_row.get_mut(usize::from(cell.row)) {
                bucket.push(cell);
            }
        }

        for (text, cells) in scrollback.rows.into_iter().zip(per_row) {
            self.rows.push_back(StoredScrollbackRow { text, cells });
        }

        while self.rows.len() > DEFAULT_MAX_SCROLLBACK {
            self.rows.pop_front();
        }
    }

    /// Read the window `[start, start + count)`, clamped to the stored rows.
    /// Each returned cell's `row` is REINDEXED to its 0-based position WITHIN
    /// the returned window (row 0 = the first returned row) so the frontend can
    /// render the slice positionally, matching `read_scrollback`'s contract.
    fn fetch(&self, start: usize, count: usize) -> GhosttyVtScrollback {
        let end = start.saturating_add(count).min(self.rows.len());
        let mut rows = Vec::new();
        let mut cells = Vec::new();

        for (window_index, source_index) in (start..end).enumerate() {
            let Some(row) = self.rows.get(source_index) else {
                break;
            };
            let window_row = window_index as u16;
            rows.push(row.text.clone());
            cells.extend(row.cells.iter().map(|cell| GhosttyVtRenderSnapshotCell {
                row: window_row,
                ..cell.clone()
            }));
        }

        GhosttyVtScrollback { rows, cells }
    }

    /// Number of rows currently held. Used by the store's tests and reserved
    /// for callers that need to bound a fetch window against what exists.
    #[allow(dead_code)]
    fn len(&self) -> usize {
        self.rows.len()
    }
}

#[derive(Debug)]
pub(crate) struct GhosttyWriteResult {
    pub snapshot: GhosttyVtRenderSnapshot,
    pub cwd_uri: Option<String>,
}

#[derive(Debug)]
pub(crate) struct GhosttySessionHandle {
    latest_snapshot: Arc<Mutex<Option<GhosttyVtRenderSnapshot>>>,
    /// Shared `Send` history buffer. Filled by the read thread (via the state's
    /// `write`) and read here by command handlers WITHOUT touching the `!Send`
    /// terminal — this is what makes the lazy fetch idle-safe.
    scrollback_store: Arc<Mutex<ScrollbackStore>>,
    resize_tx: Sender<GhosttyResize>,
}

impl Clone for GhosttySessionHandle {
    fn clone(&self) -> Self {
        Self {
            latest_snapshot: Arc::clone(&self.latest_snapshot),
            scrollback_store: Arc::clone(&self.scrollback_store),
            resize_tx: self.resize_tx.clone(),
        }
    }
}

impl GhosttySessionHandle {
    pub fn new() -> (Self, GhosttySessionReader) {
        let latest_snapshot = Arc::new(Mutex::new(None));
        let scrollback_store = Arc::new(Mutex::new(ScrollbackStore::default()));
        let (resize_tx, resize_rx) = channel();

        (
            Self {
                latest_snapshot: Arc::clone(&latest_snapshot),
                scrollback_store: Arc::clone(&scrollback_store),
                resize_tx,
            },
            GhosttySessionReader {
                latest_snapshot,
                scrollback_store,
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

    /// Read a window `[start, start + count)` of accumulated scrollback from
    /// the shared store. Reads the `Send` store, NOT the terminal — safe to
    /// call from a command handler while the read thread is parked on a
    /// blocking PTY read. A poisoned lock degrades to an empty window.
    pub fn fetch_scrollback(&self, start: u32, count: u32) -> GhosttyVtScrollback {
        match self.scrollback_store.lock() {
            Ok(store) => store.fetch(start as usize, count as usize),
            Err(_) => GhosttyVtScrollback {
                rows: Vec::new(),
                cells: Vec::new(),
            },
        }
    }
}

#[derive(Debug)]
pub(crate) struct GhosttySessionReader {
    latest_snapshot: Arc<Mutex<Option<GhosttyVtRenderSnapshot>>>,
    scrollback_store: Arc<Mutex<ScrollbackStore>>,
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
    /// Shared `Send` history buffer this state appends each frame's evicted-row
    /// delta to. A command handler reads it through `GhosttySessionHandle`
    /// without touching this `!Send` state.
    scrollback_store: Arc<Mutex<ScrollbackStore>>,
    resize_rx: Receiver<GhosttyResize>,
    /// Scrollback row count emitted on the previous frame, so `write` can read
    /// just the newly-evicted rows (the delta) instead of the whole buffer.
    last_scrollback_count: u32,
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
            scrollback_store: reader.scrollback_store,
            resize_rx: reader.resize_rx,
            last_scrollback_count: 0,
        })
    }

    pub fn write(&mut self, bytes: &[u8]) -> Result<GhosttyWriteResult, String> {
        self.apply_pending_resize()?;
        self.terminal.vt_write(bytes);
        let mut snapshot = self.snapshot()?;
        // Publish the delta-FREE snapshot for reattach: a fresh attach rebuilds
        // history from scratch, so replaying a delta would double-append.
        self.publish_snapshot(snapshot.clone());
        snapshot.scrollback_delta = self.take_scrollback_delta(&snapshot)?;

        Ok(GhosttyWriteResult {
            snapshot,
            cwd_uri: self.take_cwd_uri(),
        })
    }

    /// Append the scrollback rows newly evicted above the viewport since the
    /// previous frame into the shared `Send` store, advancing the tracked
    /// count. The store is what the lazy fetch (`fetch_scrollback`) reads, so
    /// the renderer pulls history windows on scroll-up instead of receiving an
    /// eager per-frame delta. Always returns `Ok(None)` so `write` attaches no
    /// `scrollback_delta` to the snapshot. Skips the alt screen (history is
    /// suppressed there) and any frame where nothing grew; a shrink
    /// (clear/reset) just rewinds the count — the renderer detects the reset
    /// from `scrollback_row_count` dropping below what it has rendered.
    fn take_scrollback_delta(
        &mut self,
        snapshot: &GhosttyVtRenderSnapshot,
    ) -> Result<Option<GhosttyVtScrollback>, String> {
        if snapshot.is_alt_screen == Some(true) {
            // Leave the count untouched: the normal-screen scrollback is
            // unchanged underneath, so we resume cleanly when alt exits.
            return Ok(None);
        }

        let new_count = snapshot.scrollback_row_count.unwrap_or(0);
        let last = self.last_scrollback_count;

        // No growth, or a shrink (clear/reset): rewind and emit nothing. Note:
        // once the buffer caps at DEFAULT_MAX_SCROLLBACK the count plateaus, so
        // rows evicted past the cap stop appending — acceptable for the eager
        // path; VIM-224's lazy fetch removes the cap dependency.
        if new_count <= last {
            self.last_scrollback_count = new_count;
            return Ok(None);
        }

        let added = u16::try_from(new_count - last).unwrap_or(u16::MAX);
        let delta = self.read_scrollback(last, added)?;
        self.last_scrollback_count = new_count;

        // Route the delta into the shared store instead of the snapshot. A
        // poisoned lock drops this frame's history rather than panicking the
        // read thread; the count still advances, so the next frame's window
        // simply starts after the lost rows.
        if !delta.rows.is_empty() {
            if let Ok(mut store) = self.scrollback_store.lock() {
                store.append(delta);
            }
        }

        Ok(None)
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
            scrollback_row_count,
            is_alt_screen: is_alt_screen.then_some(true),
            // The per-frame delta is attached by `write`, not the base snapshot
            // (which is also used for the reattach cache).
            scrollback_delta: None,
        })
    }

    /// Read a window of SCROLLBACK (history) rows `[start_row, start_row +
    /// row_count)`, clamped to the available scrollback, returning styled rows
    /// shaped like [`snapshot`](Self::snapshot)'s cells. Each cell's `row` is
    /// the 0-based index WITHIN the returned window (row 0 = the first returned
    /// row); `rows[i]` is the column-aligned plain text of returned row `i`.
    ///
    /// Unlike `snapshot()` (which reads the visible viewport via the RenderState
    /// `CellIteration` API), history rows are read through the lower-level
    /// `grid_ref` / `screen::Cell` / `Style` API. That path exposes raw
    /// `StyleColor`s (which may be palette indices) rather than pre-resolved
    /// RGB, so colors are resolved through the terminal palette here to match
    /// snapshot's resolved `#rrggbb` output. The grid reference is only valid
    /// until the next terminal mutation, so each cell's data is read into owned
    /// values immediately and never held across another `grid_ref` call.
    pub fn read_scrollback(
        &mut self,
        start_row: u32,
        row_count: u16,
    ) -> Result<GhosttyVtScrollback, String> {
        let scrollback_rows = self
            .terminal
            .scrollback_rows()
            .map_err(|error| error.to_string())? as u32;
        // Resolve palette indices the same way the RenderState path does, so
        // history colors match the live snapshot's resolved RGB output.
        let palette = self
            .terminal
            .color_palette()
            .map_err(|error| error.to_string())?;
        let cols = self.terminal.cols().map_err(|error| error.to_string())?;

        // Clamp the requested window to the rows that actually exist.
        let end_row = start_row
            .saturating_add(u32::from(row_count))
            .min(scrollback_rows);
        let mut rows = Vec::new();
        let mut cells = Vec::new();

        let mut history_row = start_row;
        while history_row < end_row {
            let row_index = rows.len() as u16;
            let mut row_text = String::new();
            // Display columns currently materialised in `row_text` — tracked in
            // columns (not bytes) so multi-byte glyphs stay aligned with the
            // sparse cells. Mirrors `snapshot()`.
            let mut row_columns = 0u16;

            for column in 0..cols {
                // The GridRef is only valid until the next terminal update, so
                // read everything we need from this cell into owned values
                // before resolving the next column's reference.
                let grid_ref = self
                    .terminal
                    .grid_ref(Point::History(PointCoordinate {
                        x: column,
                        y: history_row,
                    }))
                    .map_err(|error| error.to_string())?;

                let cell = grid_ref.cell().map_err(|error| error.to_string())?;
                let wide = cell.wide().map_err(|error| error.to_string())?;
                let cell_width = match wide {
                    CellWide::Wide => 2,
                    CellWide::Narrow | CellWide::SpacerTail | CellWide::SpacerHead => 1,
                };

                if matches!(wide, CellWide::SpacerTail | CellWide::SpacerHead) {
                    continue;
                }

                let text = read_grapheme_text(&grid_ref).map_err(|error| error.to_string())?;
                let style = grid_ref.style().map_err(|error| error.to_string())?;
                // `bg_color` can also come from a bg-color-only cell's content
                // tag (no style), so flatten that source too — matching how
                // `snapshot()`'s RenderState `bg_color()` flattens the cell's
                // palette/RGB background with the style background.
                let content_tag = cell.content_tag().map_err(|error| error.to_string())?;
                let foreground = resolve_style_color(style.fg_color, &palette);
                let background = match resolve_style_color(style.bg_color, &palette) {
                    Some(color) => Some(color),
                    None => resolve_cell_bg_color(&cell, content_tag, &palette)?,
                }
                .map(format_color);
                let foreground = foreground.map(format_color);

                append_row_text(&mut row_text, &mut row_columns, column, cell_width, &text);

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
                        col: column,
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

            trim_trailing_spaces(&mut row_text);
            rows.push(row_text);
            history_row += 1;
        }

        Ok(GhosttyVtScrollback { rows, cells })
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

/// Read a history cell's grapheme cluster into an owned UTF-8 string.
///
/// `GridRef::graphemes` writes codepoints (`char`s), not UTF-8 bytes (there is
/// no utf8 variant on the lower-level grid API the way RenderState has
/// `graphemes_utf8`), so the codepoints are collected into a `String` here.
/// A small inline buffer covers virtually every cell; on the rare
/// `OutOfSpace` the call reports the required length and we retry once.
fn read_grapheme_text(grid_ref: &libghostty_vt::screen::GridRef<'_>) -> Result<String, String> {
    let mut buf = ['\0'; 8];
    let len = match grid_ref.graphemes(&mut buf) {
        Ok(len) => len,
        Err(libghostty_vt::Error::OutOfSpace { required }) => {
            let mut grown = vec!['\0'; required];
            let len = grid_ref
                .graphemes(&mut grown)
                .map_err(|error| error.to_string())?;
            return Ok(grown[..len].iter().collect());
        }
        Err(error) => return Err(error.to_string()),
    };

    Ok(buf[..len].iter().collect())
}

/// Resolve a [`StyleColor`] to RGB the same way the RenderState path does:
/// an explicit RGB passes through, a palette index is looked up in the
/// terminal palette, and an unset color stays `None` (the caller then falls
/// back to the terminal default, exactly like `snapshot()`'s `fg_color()`).
fn resolve_style_color(color: StyleColor, palette: &[RgbColor; 256]) -> Option<RgbColor> {
    match color {
        StyleColor::None => None,
        StyleColor::Rgb(rgb) => Some(rgb),
        StyleColor::Palette(index) => palette.get(usize::from(index.0)).copied(),
    }
}

/// Flatten a bg-color-only cell's background (where the color lives on the
/// cell's content tag rather than its style) to RGB, resolving palette
/// indices through the terminal palette. Mirrors the cell-sourced half of
/// the RenderState `bg_color()` flattening used by `snapshot()`.
fn resolve_cell_bg_color(
    cell: &libghostty_vt::screen::Cell,
    content_tag: CellContentTag,
    palette: &[RgbColor; 256],
) -> Result<Option<RgbColor>, String> {
    match content_tag {
        CellContentTag::BgColorRgb => Ok(Some(
            cell.bg_color_rgb().map_err(|error| error.to_string())?,
        )),
        CellContentTag::BgColorPalette => {
            let index = cell.bg_color_palette().map_err(|error| error.to_string())?;
            Ok(palette.get(usize::from(index.0)).copied())
        }
        CellContentTag::Codepoint | CellContentTag::CodepointGrapheme => Ok(None),
    }
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

    /// A styled cell at `(row, col)` carrying the given text — the minimal
    /// shape the store groups by `row` and reindexes on `fetch`.
    fn cell(row: u16, col: u16, text: &str) -> GhosttyVtRenderSnapshotCell {
        GhosttyVtRenderSnapshotCell {
            row,
            col,
            text: text.to_string(),
            width: 1,
            bold: None,
            italic: None,
            underline: None,
            foreground: None,
            background: None,
            reverse: None,
        }
    }

    #[test]
    fn scrollback_store_is_send() {
        // Compile-time proof the store (and the handle that carries it) hold
        // only Send data — the whole point of the lazy model is that a command
        // handler can read the store while the terminal is parked on a blocking
        // read on another thread.
        _assert_send::<ScrollbackStore>();
        _assert_send::<GhosttySessionHandle>();
    }

    #[test]
    fn fetch_scrollback_surfaces_rows_evicted_into_the_store() {
        // The read thread fills the store via `write`'s delta; a command
        // handler later reads it through the handle WITHOUT touching the
        // terminal. `create_state` consumes the reader, so clone the handle
        // first to keep a store-reading view for the assertion.
        let (handle, reader) = GhosttySessionHandle::new();
        let handle = handle.clone();
        let mut state = reader
            .create_state(80, 3)
            .expect("create ghostty terminal state");
        fill_past_viewport(&mut state);

        let scrollback = handle.fetch_scrollback(0, 10);

        assert!(
            scrollback.rows.iter().any(|row| row.contains("line 0")),
            "the store must hold the earliest evicted row, got {:?}",
            scrollback.rows
        );
    }

    #[test]
    fn scrollback_store_caps_at_default_max_keeping_the_most_recent_row() {
        let mut store = ScrollbackStore::default();
        let overflow = DEFAULT_MAX_SCROLLBACK + 5;
        for index in 0..overflow {
            store.append(GhosttyVtScrollback {
                rows: vec![format!("line {index}")],
                cells: vec![cell(0, 0, "l")],
            });
        }

        assert_eq!(
            store.len(),
            DEFAULT_MAX_SCROLLBACK,
            "the store must evict from the front so it never exceeds the cap"
        );
        let last = store.fetch(store.len() - 1, 1);
        assert_eq!(
            last.rows,
            vec![format!("line {}", overflow - 1)],
            "the most-recent appended row must survive the front eviction"
        );
    }

    #[test]
    fn scrollback_store_fetch_reindexes_cell_rows_to_window_position() {
        // Two 2-row deltas land in the store with per-delta `row` indices
        // (0,1 each). A fetch across both must renumber every cell's `row` to
        // its 0-based position WITHIN the returned window (0,1,2,3), not the
        // original delta indices — the frontend renders rows by that offset.
        let mut store = ScrollbackStore::default();
        store.append(GhosttyVtScrollback {
            rows: vec!["a0".to_string(), "a1".to_string()],
            cells: vec![cell(0, 0, "a"), cell(1, 0, "a")],
        });
        store.append(GhosttyVtScrollback {
            rows: vec!["b0".to_string(), "b1".to_string()],
            cells: vec![cell(0, 0, "b"), cell(1, 0, "b")],
        });

        let window = store.fetch(0, 4);

        assert_eq!(window.rows.len(), 4);
        let rows: Vec<u16> = window.cells.iter().map(|cell| cell.row).collect();
        assert_eq!(
            rows,
            vec![0, 1, 2, 3],
            "cell rows must be reindexed to their window position, got {rows:?}"
        );
    }

    #[test]
    fn scrollback_store_fetch_clamps_past_the_end() {
        let mut store = ScrollbackStore::default();
        store.append(GhosttyVtScrollback {
            rows: vec!["only".to_string()],
            cells: vec![],
        });

        let window = store.fetch(0, 10);
        assert_eq!(window.rows, vec!["only".to_string()]);

        let past_end = store.fetch(5, 3);
        assert!(
            past_end.rows.is_empty() && past_end.cells.is_empty(),
            "a window entirely past the end must be empty"
        );
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

    #[test]
    fn write_routes_newly_evicted_rows_into_the_store() {
        // The per-frame delta no longer rides the snapshot (it always carries
        // `scrollback_delta: None` now); `write` appends each delta into the
        // Send store instead, where the lazy fetch reads it. Keep a cloned
        // handle for the store view since `create_state` consumes the reader.
        let (handle, reader) = GhosttySessionHandle::new();
        let handle = handle.clone();
        let mut state = reader
            .create_state(80, 3)
            .expect("create ghostty terminal state");
        for index in 0..8 {
            let result = state
                .write(format!("line {index}\r\n").as_bytes())
                .expect("write");
            assert!(
                result.snapshot.scrollback_delta.is_none(),
                "the delta is routed to the store, never attached to the snapshot"
            );
        }

        let stored = handle.fetch_scrollback(0, 100);
        assert!(
            stored.rows.iter().any(|row| row.contains("line 0")),
            "rows evicted past the 3-row viewport must land in the store, got {:?}",
            stored.rows
        );
    }

    #[test]
    fn store_tiles_every_evicted_row_exactly_once() {
        // The store APPENDs each frame's delta, so the stored row count must
        // exactly equal the terminal's scrollback count — no duplicates, no
        // gaps. (Previously asserted against the summed snapshot deltas.)
        let (handle, reader) = GhosttySessionHandle::new();
        let handle = handle.clone();
        let mut state = reader
            .create_state(80, 3)
            .expect("create ghostty terminal state");
        for index in 0..10 {
            state
                .write(format!("line {index}\r\n").as_bytes())
                .expect("write");
        }
        let final_count = state
            .snapshot()
            .expect("snapshot")
            .scrollback_row_count
            .unwrap_or(0);

        let stored_len = handle.fetch_scrollback(0, u32::MAX).rows.len() as u32;
        assert_eq!(
            stored_len, final_count,
            "stored row count must equal total scrollback count"
        );
    }

    #[test]
    fn write_does_not_grow_the_store_on_the_alternate_screen() {
        // History is suppressed on the alt screen: the snapshot still carries
        // no delta, and the store must not grow while alt is active.
        let (handle, reader) = GhosttySessionHandle::new();
        let handle = handle.clone();
        let mut state = reader
            .create_state(80, 3)
            .expect("create ghostty terminal state");
        fill_past_viewport(&mut state);
        let before = handle.fetch_scrollback(0, u32::MAX).rows.len();

        let result = state
            .write(b"\x1b[?1049h\x1b[1mfullscreen\x1b[0m")
            .expect("write alt");

        assert!(
            result.snapshot.scrollback_delta.is_none(),
            "history is suppressed on the alt screen"
        );
        assert_eq!(
            handle.fetch_scrollback(0, u32::MAX).rows.len(),
            before,
            "the store must not grow while the alt screen is active"
        );
    }

    #[test]
    fn read_scrollback_returns_history_rows_that_scrolled_off_screen() {
        // A 3-row viewport pushes the early `line {i}` writes into scrollback.
        // Reading the history window back must surface that off-screen text.
        let mut state = make_state(80, 3);
        fill_past_viewport(&mut state);

        let scrollback = state.read_scrollback(0, 10).expect("read scrollback");

        assert!(
            scrollback.rows.iter().any(|row| row.contains("line 0")),
            "scrollback must contain the earliest off-screen line, got {:?}",
            scrollback.rows
        );
        assert!(
            scrollback.rows.iter().any(|row| row.contains("line 1")),
            "scrollback must contain subsequent off-screen lines, got {:?}",
            scrollback.rows
        );
    }

    #[test]
    fn read_scrollback_resolves_styled_history_foreground_to_rgb() {
        // A truecolor-styled line repeated enough times to scroll the earliest
        // copies into history. Reading them back must preserve the resolved
        // foreground hex on the styled cells — history fidelity matches the
        // live snapshot's resolved colors.
        let mut state = make_state(80, 3);
        for _ in 0..12 {
            state
                .write(b"\x1b[38;2;137;180;250mhello\x1b[0m\r\n")
                .expect("write styled line");
        }

        let scrollback = state.read_scrollback(0, 20).expect("read scrollback");

        let h_cell = scrollback
            .cells
            .iter()
            .find(|cell| cell.text == "h")
            .expect("a styled 'h' cell in history");
        assert_eq!(
            h_cell.foreground,
            Some("#89b4fa".to_string()),
            "styled history foreground must resolve to RGB hex, got {:?}",
            h_cell.foreground
        );
    }
}
