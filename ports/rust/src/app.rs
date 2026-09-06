//! The application: owns the terminal, both framebuffers, the scheduler and the
//! event loop.
//!
//! The reference implementation runs the loop for you and calls back into a
//! render function. Rust turns that inside out, because a callback that mutates
//! the app's state is the one shape that fights ownership hardest:
//!
//! ```no_run
//! use hqtui::prelude::*;
//!
//! fn main() -> std::io::Result<()> {
//!     let mut app = App::new()?;
//!     let mut count = 0u32;
//!
//!     while app.running() {
//!         for event in app.poll()? {
//!             if let InputEvent::Key(k) = event {
//!                 if k.key == "ctrl+c" || k.name == "q" { app.quit(); }
//!                 if k.name == "up" { count += 1; }
//!             }
//!         }
//!         let label = format!("count: {count}");
//!         app.draw(|f| {
//!             f.ui.panel(Panel::new().title("Counter"), |p| {
//!                 p.text(&label);
//!             });
//!         })?;
//!     }
//!     Ok(())
//! }
//! ```
//!
//! Your state stays yours: no `Rc<RefCell<_>>`, no callbacks, no borrow
//! gymnastics. The loop is three lines, and it is visible.

use std::cell::RefCell;
use std::io;
use std::rc::Rc;
use std::time::{Duration, Instant};

use crate::ansi;
use crate::buffer::FrameBuffer;
use crate::capabilities::{Capabilities, ColorDepth};
use crate::diff::{Encoder, EncoderOptions};
use crate::input::{match_key, InputEvent, MouseAction};
use crate::layout::Direction;
use crate::surface::Surface;
use crate::terminal::{Terminal, TerminalOptions, TerminalSize};
use crate::theme::{resolve_theme, Theme};
use crate::ui::{Container, Ctx, HitRegion, Interaction, Layout};

#[derive(Clone, Debug)]
pub struct AppOptions {
    pub terminal: TerminalOptions,
    /// Theme object or built-in name. Defaults to the dark theme.
    pub theme: Option<String>,
    /// Cap on frames per second. Default 30, or 15 over SSH.
    pub fps: u32,
    /// Frame cap when an SSH session is detected.
    pub remote_fps: u32,
    /// Keys that quit. Default `ctrl+c` and `q`. Pass an empty list to handle
    /// quitting yourself.
    pub quit_keys: Vec<String>,
    /// Tab/Shift+Tab move focus. Default true.
    pub focus_navigation: bool,
    /// Paint the theme background across the whole screen. Default true.
    pub paint_background: bool,
    /// Drain color, for accessibility or `NO_COLOR`.
    pub monochrome: Option<bool>,
}

impl Default for AppOptions {
    fn default() -> AppOptions {
        AppOptions {
            terminal: TerminalOptions::default(),
            theme: None,
            fps: 30,
            remote_fps: 15,
            quit_keys: vec!["ctrl+c".into(), "q".into()],
            focus_navigation: true,
            paint_background: true,
            monochrome: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FrameStats {
    pub frame: u64,
    /// Time spent building, diffing and writing.
    pub render: Duration,
    pub changed_cells: usize,
    pub dirty_rows: usize,
    pub bytes: usize,
}

/// What a render closure is handed.
pub struct RenderArgs<'a, 'b> {
    pub ui: &'a mut Container<'b>,
    pub theme: Rc<Theme>,
    pub capabilities: Rc<Capabilities>,
    pub width: usize,
    pub height: usize,
    pub frame: u64,
    pub elapsed: Duration,
    /// Index of the focused control, in registration order.
    pub focus: usize,
}

pub struct App {
    pub terminal: Terminal,
    pub capabilities: Rc<Capabilities>,
    pub theme: Rc<Theme>,
    options: AppOptions,

    current: Rc<RefCell<FrameBuffer>>,
    previous: FrameBuffer,
    encoder: Encoder,

    running: bool,
    force_repaint: bool,
    started_at: Instant,
    last_poll: Instant,
    frame_count: u64,
    last_stats: FrameStats,

    focus_index: usize,
    focus_ids: Vec<String>,
    hits: Vec<HitRegion>,
    interactions: Vec<Interaction>,
}

impl App {
    pub fn new() -> io::Result<App> {
        App::with_options(AppOptions::default())
    }

    pub fn with_options(options: AppOptions) -> io::Result<App> {
        let mut terminal = Terminal::new(options.terminal.clone());
        let capabilities = Rc::new(terminal.capabilities.clone());
        let theme = Rc::new(resolve_theme(options.theme.as_deref().unwrap_or("dark")));

        let TerminalSize { columns, rows } = terminal.size();
        let current = Rc::new(RefCell::new(FrameBuffer::new(columns, rows)));
        let previous = FrameBuffer::new(columns, rows);
        let encoder = Encoder::new(EncoderOptions {
            colors: Some(capabilities.colors),
            monochrome: options
                .monochrome
                .unwrap_or(capabilities.colors == ColorDepth::None),
        });

        terminal.enter();
        let now = Instant::now();
        Ok(App {
            terminal,
            capabilities,
            theme,
            options,
            current,
            previous,
            encoder,
            running: true,
            force_repaint: true,
            started_at: now,
            last_poll: now,
            frame_count: 0,
            last_stats: FrameStats::default(),
            focus_index: 0,
            focus_ids: Vec::new(),
            hits: Vec::new(),
            interactions: Vec::new(),
        })
    }

    pub fn width(&self) -> usize {
        self.current.borrow().width
    }

    pub fn height(&self) -> usize {
        self.current.borrow().height
    }

    pub fn stats(&self) -> FrameStats {
        self.last_stats
    }

    pub fn running(&self) -> bool {
        self.running
    }

    /// Stop the loop. The terminal is restored when the `App` is dropped, or
    /// immediately if you call [`App::restore`].
    pub fn quit(&mut self) {
        self.running = false;
    }

    pub fn restore(&mut self) {
        self.terminal.restore();
    }

    /// Force a full repaint, e.g. after another process wrote to the terminal.
    pub fn redraw(&mut self) {
        self.force_repaint = true;
    }

    pub fn set_theme(&mut self, theme: &str) {
        self.theme = Rc::new(resolve_theme(theme));
        self.force_repaint = true;
    }

    fn target_fps(&self) -> u32 {
        if self.capabilities.ssh {
            self.options.fps.min(self.options.remote_fps)
        } else {
            self.options.fps
        }
    }

    /// Everything that happened since the last call, after the app has taken
    /// its own turn: quit keys, focus navigation and mouse dispatch.
    ///
    /// Blocks for at most one frame interval, which is what paces the loop.
    pub fn poll(&mut self) -> io::Result<Vec<InputEvent>> {
        let interval = Duration::from_millis((1000 / self.target_fps().max(1)).max(8) as u64);
        let waited = self.last_poll.elapsed();
        if waited < interval {
            std::thread::sleep(interval - waited);
        }
        let waited = self.last_poll.elapsed();
        self.last_poll = Instant::now();

        if self.terminal.termination_signal().is_some() {
            self.running = false;
        }
        if self.terminal.take_resize() {
            let TerminalSize { columns, rows } = self.terminal.size();
            self.current.borrow_mut().resize(columns, rows);
            self.previous.resize(columns, rows);
            self.force_repaint = true;
        }

        self.interactions.clear();
        let events = self.terminal.poll_input(waited);
        for event in &events {
            match event {
                InputEvent::Key(key) => {
                    if self.options.quit_keys.iter().any(|k| match_key(key, k)) {
                        self.running = false;
                    }
                    if self.options.focus_navigation {
                        if key.name == "tab" {
                            self.focus_next(if key.shift { -1 } else { 1 });
                        } else if key.name == "enter" || key.name == "space" {
                            if let Some(id) = self.focus_ids.get(self.focus_index) {
                                self.interactions
                                    .push(Interaction::Activated { id: id.clone() });
                            }
                        }
                    }
                }
                InputEvent::Mouse(mouse) => self.dispatch_mouse(mouse),
                _ => {}
            }
        }
        Ok(events)
    }

    /// Move keyboard focus. Wraps around.
    pub fn focus_next(&mut self, delta: i64) {
        let count = self.focus_ids.len() as i64;
        if count == 0 {
            return;
        }
        self.focus_index = (((self.focus_index as i64 + delta) % count + count) % count) as usize;
    }

    /// The id of the focused control, if the last frame registered any.
    pub fn focused(&self) -> Option<&str> {
        self.focus_ids.get(self.focus_index).map(String::as_str)
    }

    fn dispatch_mouse(&mut self, event: &crate::input::MouseEvent) {
        // Later regions are drawn on top, so hit-test in reverse.
        for hit in self.hits.iter().rev() {
            if !hit.rect.contains(event.x as isize, event.y as isize) {
                continue;
            }
            let x = event.x - hit.rect.x as usize;
            let y = event.y - hit.rect.y as usize;
            match event.action {
                MouseAction::Scroll => self
                    .interactions
                    .push(Interaction::Scrolled { id: hit.id.clone(), delta: event.scroll }),
                MouseAction::Press => {
                    self.interactions.push(Interaction::Clicked { id: hit.id.clone(), x, y })
                }
                MouseAction::Move => {
                    self.interactions.push(Interaction::Hovered { id: hit.id.clone(), x, y })
                }
                _ => {}
            }
            return;
        }
    }

    /// Everything the controls reported this frame.
    pub fn interactions(&self) -> &[Interaction] {
        &self.interactions
    }

    /// Was this control clicked, or activated from the keyboard?
    pub fn pressed(&self, id: &str) -> bool {
        self.interactions.iter().any(|i| {
            matches!(i, Interaction::Clicked { .. } | Interaction::Activated { .. })
                && i.id() == id
        })
    }

    /// Wheel movement over this control: -1 up, 1 down, summed.
    pub fn scrolled(&self, id: &str) -> i32 {
        self.interactions
            .iter()
            .filter_map(|i| match i {
                Interaction::Scrolled { id: hit, delta } if hit == id => Some(*delta),
                _ => None,
            })
            .sum()
    }

    /// Which row of a scrollable widget was clicked, counted from its first
    /// body row so a table's header does not shift every index by one.
    pub fn clicked_row(&self, id: &str) -> Option<usize> {
        let header = self.hits.iter().find(|h| h.id == id).map(|h| h.header_rows).unwrap_or(0);
        self.interactions.iter().find_map(|i| match i {
            Interaction::Clicked { id: hit, y, .. } if hit == id && *y >= header => {
                Some(y - header)
            }
            _ => None,
        })
    }

    /// Build one frame and push the difference to the terminal.
    pub fn draw<'v>(
        &mut self,
        view: impl FnOnce(&mut RenderArgs<'_, 'v>),
    ) -> io::Result<FrameStats> {
        let started = Instant::now();

        let size = self.terminal.size();
        if size.columns != self.width() || size.rows != self.height() {
            self.current.borrow_mut().resize(size.columns, size.rows);
            self.previous.resize(size.columns, size.rows);
            self.force_repaint = true;
        }

        let (width, height) = (self.width(), self.height());
        self.current.borrow_mut().clear(
            if self.options.paint_background {
                self.theme.background
            } else {
                crate::color::Color::DEFAULT
            },
            self.theme.foreground,
        );

        let mut ctx = Ctx::new(self.theme.clone(), self.capabilities.clone(), width, height);
        ctx.frame = self.frame_count;
        ctx.elapsed = self.started_at.elapsed().as_millis() as u64;
        ctx.focus_index = self.focus_index;
        let ctx = Rc::new(ctx);

        let root = Surface::root(self.current.clone(), self.theme.clone());
        let mut container =
            Container::new(root.clone(), ctx.clone(), Direction::Column, &Layout::default());
        {
            let mut args = RenderArgs {
                ui: &mut container,
                theme: self.theme.clone(),
                capabilities: self.capabilities.clone(),
                width,
                height,
                frame: self.frame_count,
                elapsed: self.started_at.elapsed(),
                focus: self.focus_index,
            };
            view(&mut args);
        }
        container.flush();
        for overlay in ctx.take_overlays() {
            overlay.draw(&root);
        }

        self.hits = ctx.hits();
        self.focus_ids = ctx.focus_ids();
        if !self.focus_ids.is_empty() && self.focus_index >= self.focus_ids.len() {
            self.focus_index = 0;
        }

        let result = {
            let current = self.current.borrow();
            self.encoder.encode(&self.previous, &current, self.force_repaint)
        };
        self.force_repaint = false;

        let mut output = result.output;
        if !output.is_empty() {
            if self.capabilities.synchronized_output {
                output = format!("{}{}{}", ansi::BEGIN_SYNC, output, ansi::END_SYNC);
            }
            self.terminal.write(&output);
        }
        self.previous.copy_from(&self.current.borrow());

        let stats = FrameStats {
            frame: self.frame_count,
            render: started.elapsed(),
            changed_cells: result.changed_cells,
            dirty_rows: result.dirty_rows,
            bytes: output.len(),
        };
        self.frame_count += 1;
        self.last_stats = stats;
        Ok(stats)
    }

    /// Run a whole app: poll, then draw, until something calls `quit`.
    ///
    /// The view is called afresh every frame, so it cannot borrow state that it
    /// also mutates — use the explicit `poll`/`draw` loop for that, which is
    /// what most apps want anyway.
    pub fn run(mut self, mut view: impl FnMut(&mut RenderArgs)) -> io::Result<()> {
        while self.running() {
            self.poll()?;
            self.draw(&mut view)?;
        }
        self.restore();
        Ok(())
    }
}
