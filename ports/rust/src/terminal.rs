//! Owns the TTY: raw mode, alternate screen, mouse reporting, and — above all —
//! putting everything back. A crashed app must never leave an unusable shell.
//!
//! # How this talks to the operating system
//!
//! The crate has no dependencies, so it cannot reach for `libc` or `nix`, and
//! it uses two different mechanisms rather than one:
//!
//! * **Mode switching goes through `stty`.** Declaring `struct termios` by hand
//!   means a different field layout and a different set of flag constants for
//!   Linux, macOS and each BSD — one of which would be wrong and untested.
//!   `stty -g` hands back an opaque description of the *current* settings and
//!   takes it back verbatim, so restoring is exact rather than reconstructed,
//!   and it behaves identically everywhere. The cost is two short-lived
//!   processes for the life of the app, which is not measurable next to a
//!   single frame.
//!
//! * **Window size and signals go through a handful of C calls.** These cannot
//!   be shelled out to: the size is read every frame, and a signal has to
//!   arrive as a signal. Both are declared here directly. `struct winsize` is
//!   four `u16`s on every Unix, and `signal()` has one standard signature, so
//!   unlike `termios` there is nothing platform-shaped to get wrong. The
//!   handler only sets an atomic flag, which is async-signal-safe.
//!
//! Windows is not supported by this module yet. Everything above it — the
//! framebuffer, the widgets, the encoder, the headless renderer — is pure
//! computation and runs anywhere.

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use crate::ansi;
use crate::capabilities::{detect_capabilities, Capabilities, CapabilityOverrides};
use crate::input::{InputEvent, InputParser};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerminalSize {
    pub columns: usize,
    pub rows: usize,
}

#[derive(Clone, Debug)]
pub struct TerminalOptions {
    /// Use the alternate screen so the user's scrollback survives. Default true.
    pub alternate_screen: bool,
    pub mouse: Option<bool>,
    pub hide_cursor: bool,
    pub bracketed_paste: Option<bool>,
    pub focus_events: Option<bool>,
    pub title: Option<String>,
    pub capabilities: CapabilityOverrides,
    /// Restore the terminal on SIGTERM/SIGHUP and on panic. Default true.
    pub install_exit_handlers: bool,
    /// How long to wait before a lone ESC counts as the Escape key.
    pub escape_timeout: Duration,
}

impl Default for TerminalOptions {
    fn default() -> TerminalOptions {
        TerminalOptions {
            alternate_screen: true,
            mouse: None,
            hide_cursor: true,
            bracketed_paste: None,
            focus_events: None,
            title: None,
            capabilities: CapabilityOverrides::default(),
            install_exit_handlers: true,
            escape_timeout: Duration::from_millis(30),
        }
    }
}

// --------------------------------------------------------------- OS plumbing

#[allow(non_camel_case_types)]
type c_int = i32;
#[allow(non_camel_case_types)]
type c_ulong = std::os::raw::c_ulong;

/// Four `u16`s on Linux, macOS and every BSD.
#[repr(C)]
#[derive(Default)]
struct WinSize {
    rows: u16,
    cols: u16,
    x_pixels: u16,
    y_pixels: u16,
}

#[cfg(target_os = "linux")]
const TIOCGWINSZ: c_ulong = 0x5413;
#[cfg(not(target_os = "linux"))]
const TIOCGWINSZ: c_ulong = 0x4008_7468;

const SIGWINCH: c_int = 28;
const SIGTERM: c_int = 15;
const SIGHUP: c_int = 1;
const SIGINT: c_int = 2;

#[cfg(unix)]
extern "C" {
    fn ioctl(fd: c_int, request: c_ulong, arg: *mut WinSize) -> c_int;
    fn signal(signum: c_int, handler: usize) -> usize;
}

static RESIZED: AtomicBool = AtomicBool::new(false);
/// The signal that asked us to quit, or 0. Set from a handler, so it may only
/// ever be a plain atomic store.
static TERMINATED: AtomicU32 = AtomicU32::new(0);

extern "C" fn on_winch(_sig: c_int) {
    RESIZED.store(true, Ordering::Relaxed);
}

extern "C" fn on_terminate(sig: c_int) {
    TERMINATED.store(sig as u32, Ordering::Relaxed);
}

/// Ask the kernel for the window size. `None` when stdout is not a terminal.
#[cfg(unix)]
fn window_size() -> Option<TerminalSize> {
    let mut ws = WinSize::default();
    // SAFETY: `ioctl` writes at most `size_of::<WinSize>()` bytes into `ws`,
    // which is a live, correctly-aligned local of exactly that type.
    let rc = unsafe { ioctl(1, TIOCGWINSZ, &mut ws) };
    if rc != 0 || ws.cols == 0 || ws.rows == 0 {
        return None;
    }
    Some(TerminalSize { columns: ws.cols as usize, rows: ws.rows as usize })
}

#[cfg(not(unix))]
fn window_size() -> Option<TerminalSize> {
    None
}

/// The `stty -g` string captured when raw mode was entered, so it can be handed
/// straight back. Global because a panic hook has no `self` to reach for.
fn saved_mode() -> &'static Mutex<Option<String>> {
    static SAVED: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    SAVED.get_or_init(|| Mutex::new(None))
}

fn stty(args: &[&str]) -> Option<String> {
    let tty = std::fs::File::open("/dev/tty").ok()?;
    let out = Command::new("stty")
        .args(args)
        .stdin(Stdio::from(tty))
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn enter_raw_mode() -> bool {
    if let Some(saved) = stty(&["-g"]) {
        *saved_mode().lock().unwrap() = Some(saved);
    }
    // `-isig` matters: Ctrl+C has to arrive as a keystroke, because quitting is
    // the application's decision and `quit_keys` is configurable.
    stty(&["raw", "-echo", "-isig"]).is_some()
}

fn leave_raw_mode() {
    let saved = saved_mode().lock().unwrap().take();
    match saved {
        Some(mode) => {
            stty(&[&mode]);
        }
        None => {
            stty(&["sane"]);
        }
    }
}

// ------------------------------------------------------------------ terminal

/// Restores the terminal for a process that lost its `Terminal`. Safe to call
/// twice, and safe to call from a panic hook.
pub fn emergency_restore() {
    let mut out = std::io::stdout();
    let _ = out.write_all(
        format!(
            "{}{}{}{}{}{}",
            ansi::RESET,
            ansi::FOCUS_OFF,
            ansi::BRACKETED_PASTE_OFF,
            ansi::MOUSE_OFF,
            ansi::CURSOR_SHOW,
            ansi::ALTERNATE_SCREEN_OFF
        )
        .as_bytes(),
    );
    let _ = out.flush();
    leave_raw_mode();
}

pub struct Terminal {
    pub capabilities: Capabilities,
    pub escape_timeout: Duration,
    options: TerminalOptions,
    parser: InputParser,
    entered: bool,
    raw_was_set: bool,
    input: Option<Receiver<Vec<u8>>>,
    /// Bytes that ended mid-character, held until the rest of them arrive.
    partial: Vec<u8>,
}

impl Terminal {
    pub fn new(options: TerminalOptions) -> Terminal {
        let capabilities = detect_capabilities(&options.capabilities);
        Terminal {
            escape_timeout: options.escape_timeout,
            capabilities,
            options,
            parser: InputParser::new(),
            entered: false,
            raw_was_set: false,
            input: None,
            partial: Vec::new(),
        }
    }

    /// The current window size, falling back the way the reference does: the
    /// kernel, then `COLUMNS`/`LINES`, then 80x24. Anything that is not a
    /// positive number means "ask somewhere else" — some ptys report zero,
    /// which would otherwise leave a 0x0 framebuffer that renders nothing.
    pub fn size(&self) -> TerminalSize {
        if let Some(size) = window_size() {
            return size;
        }
        let from_env = |name: &str| -> Option<usize> {
            std::env::var(name).ok()?.trim().parse::<usize>().ok().filter(|n| *n > 0)
        };
        TerminalSize {
            columns: from_env("COLUMNS").unwrap_or(80),
            rows: from_env("LINES").unwrap_or(24),
        }
    }

    /// True when a SIGWINCH has arrived since this was last called.
    pub fn take_resize(&self) -> bool {
        RESIZED.swap(false, Ordering::Relaxed)
    }

    /// The signal that asked the process to quit, if one has arrived.
    pub fn termination_signal(&self) -> Option<i32> {
        match TERMINATED.load(Ordering::Relaxed) {
            0 => None,
            sig => Some(sig as i32),
        }
    }

    pub fn write(&self, data: &str) {
        if data.is_empty() {
            return;
        }
        let mut out = std::io::stdout();
        let _ = out.write_all(data.as_bytes());
        let _ = out.flush();
    }

    /// Enter full-screen mode. Idempotent.
    pub fn enter(&mut self) {
        if self.entered {
            return;
        }
        self.entered = true;

        let mouse = self.options.mouse.unwrap_or(self.capabilities.mouse);
        let paste = self.options.bracketed_paste.unwrap_or(self.capabilities.bracketed_paste);
        let focus = self.options.focus_events.unwrap_or(self.capabilities.focus_events);

        let mut setup = String::new();
        if self.options.alternate_screen {
            setup.push_str(ansi::ALTERNATE_SCREEN_ON);
        }
        if self.options.hide_cursor {
            setup.push_str(ansi::CURSOR_HIDE);
        }
        if mouse && self.capabilities.mouse {
            setup.push_str(ansi::MOUSE_ON);
        }
        if paste {
            setup.push_str(ansi::BRACKETED_PASTE_ON);
        }
        if focus {
            setup.push_str(ansi::FOCUS_ON);
        }
        if let Some(title) = &self.options.title {
            setup.push_str(&ansi::set_title(title));
        }
        setup.push_str(ansi::CLEAR_SCREEN);
        setup.push_str(ansi::CURSOR_HOME);
        self.write(&setup);

        if self.capabilities.tty {
            self.raw_was_set = enter_raw_mode();
        }
        self.start_reader();
        if self.options.install_exit_handlers {
            install_exit_handlers();
        }
    }

    /// Put the terminal back exactly as it was found. Safe to call twice.
    pub fn restore(&mut self) {
        if !self.entered {
            return;
        }
        self.entered = false;

        let mouse = self.options.mouse.unwrap_or(self.capabilities.mouse);
        let paste = self.options.bracketed_paste.unwrap_or(self.capabilities.bracketed_paste);
        let focus = self.options.focus_events.unwrap_or(self.capabilities.focus_events);

        let mut teardown = String::from(ansi::RESET);
        if focus {
            teardown.push_str(ansi::FOCUS_OFF);
        }
        if paste {
            teardown.push_str(ansi::BRACKETED_PASTE_OFF);
        }
        if mouse {
            teardown.push_str(ansi::MOUSE_OFF);
        }
        if self.options.hide_cursor {
            teardown.push_str(ansi::CURSOR_SHOW);
        }
        teardown.push_str(if self.options.alternate_screen {
            ansi::ALTERNATE_SCREEN_OFF
        } else {
            "\n"
        });
        self.write(&teardown);

        if self.raw_was_set {
            leave_raw_mode();
            self.raw_was_set = false;
        }
    }

    /// Read stdin on its own thread. The reader owns the blocking read so the
    /// render loop never does, which is what keeps a frame from waiting on a
    /// keystroke that may never come.
    fn start_reader(&mut self) {
        if self.input.is_some() {
            return;
        }
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut stdin = std::io::stdin();
            let mut buf = [0u8; 4096];
            loop {
                match stdin.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        self.input = Some(rx);
    }

    /// Every input event available right now, decoded. Never blocks.
    ///
    /// A lone ESC is only the Escape key once nothing follows it, so it is held
    /// back until `escape_timeout` has passed with no further bytes; pass the
    /// time since the last call so the caller's own clock decides.
    pub fn poll_input(&mut self, waited: Duration) -> Vec<InputEvent> {
        let mut events = Vec::new();
        let mut received = false;

        loop {
            let chunk = match self.input.as_ref() {
                Some(rx) => match rx.try_recv() {
                    Ok(chunk) => chunk,
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => break,
                },
                None => break,
            };
            received = true;
            self.partial.extend_from_slice(&chunk);
            // A read can end in the middle of a multi-byte character. Decode
            // what is whole and keep the tail for the next read, or the parser
            // would see a replacement character where a letter belongs.
            let text = match std::str::from_utf8(&self.partial) {
                Ok(s) => {
                    let owned = s.to_string();
                    self.partial.clear();
                    owned
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    let owned =
                        String::from_utf8_lossy(&self.partial[..valid]).into_owned();
                    self.partial.drain(..valid);
                    // An actually invalid sequence, rather than a truncated one,
                    // would otherwise wedge the buffer for ever.
                    if e.error_len().is_some() {
                        self.partial.remove(0);
                    }
                    owned
                }
            };
            events.extend(self.parser.parse(&text));
        }

        if !received && self.parser.has_pending() && waited >= self.escape_timeout {
            events.extend(self.parser.flush());
        }
        events
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        self.restore();
    }
}

pub fn create_terminal(options: TerminalOptions) -> Terminal {
    Terminal::new(options)
}

/// Restoring is not negotiable — a panic must not leave an unusable shell — but
/// deciding the process should die is the host's call, not a rendering
/// library's. So the handlers here only record the signal and restore the
/// terminal; the app loop notices and exits on its own terms.
fn install_exit_handlers() {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    INSTALLED.get_or_init(|| {
        #[cfg(unix)]
        // SAFETY: both handlers only store to an `AtomicBool`/`AtomicU32`,
        // which is async-signal-safe. `signal` itself is the portable form and
        // takes a plain `extern "C" fn(c_int)`.
        unsafe {
            signal(SIGWINCH, on_winch as *const () as usize);
            signal(SIGTERM, on_terminate as *const () as usize);
            signal(SIGHUP, on_terminate as *const () as usize);
            // SIGINT is delivered only if raw mode failed; with `-isig` set,
            // Ctrl+C arrives as a keystroke instead.
            signal(SIGINT, on_terminate as *const () as usize);
        }

        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            // The terminal is usable again, so the backtrace is readable.
            emergency_restore();
            previous(info);
        }));
    });
}
