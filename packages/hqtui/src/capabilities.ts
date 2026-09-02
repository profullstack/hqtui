/**
 * What the terminal can actually do. Detection is deliberately conservative:
 * we degrade colors and glyphs rather than print mojibake on someone's console.
 */

export type ColorDepth = "truecolor" | "ansi256" | "ansi16" | "none";

export interface Capabilities {
  /** stdout is a real TTY, not a pipe or a file. */
  tty: boolean;
  colors: ColorDepth;
  trueColor: boolean;
  unicode: boolean;
  braille: boolean;
  mouse: boolean;
  /** DEC 2026 atomic frame updates. */
  synchronizedOutput: boolean;
  bracketedPaste: boolean;
  focusEvents: boolean;
  tmux: boolean;
  screen: boolean;
  ssh: boolean;
  windows: boolean;
  /** Best guess at the emulator: kitty, wezterm, ghostty, iterm, alacritty, vscode, windows-terminal, xterm, unknown. */
  program: string;
}

export interface CapabilityOverrides {
  colors?: ColorDepth;
  unicode?: boolean;
  braille?: boolean;
  mouse?: boolean;
  synchronizedOutput?: boolean;
  tty?: boolean;
}

function detectProgram(env: NodeJS.ProcessEnv): string {
  if (env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty") return "kitty";
  if (env.WEZTERM_EXECUTABLE || env.TERM_PROGRAM === "WezTerm") return "wezterm";
  if (env.GHOSTTY_RESOURCES_DIR || env.TERM === "xterm-ghostty") return "ghostty";
  if (env.TERM_PROGRAM === "iTerm.app") return "iterm";
  if (env.ALACRITTY_WINDOW_ID || env.TERM === "alacritty") return "alacritty";
  if (env.TERM_PROGRAM === "vscode") return "vscode";
  if (env.WT_SESSION) return "windows-terminal";
  if (env.TERM_PROGRAM === "Apple_Terminal") return "apple-terminal";
  if (env.KONSOLE_VERSION) return "konsole";
  if ((env.TERM ?? "").startsWith("xterm")) return "xterm";
  return "unknown";
}

function detectColors(env: NodeJS.ProcessEnv, tty: boolean): ColorDepth {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return "none";
  if (env.FORCE_COLOR === "0") return "none";
  if (env.FORCE_COLOR === "1") return "ansi16";
  if (env.FORCE_COLOR === "2") return "ansi256";
  if (env.FORCE_COLOR === "3") return "truecolor";
  // Node and npm commonly export FORCE_COLOR=true, and anything set but not a
  // level still means "yes". Only "0" means no.
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "") return "ansi16";
  if (!tty) return "none";
  const term = env.TERM ?? "";
  if (term === "dumb") return "none";
  const colorterm = (env.COLORTERM ?? "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
  const program = detectProgram(env);
  if (["kitty", "wezterm", "ghostty", "iterm", "vscode", "windows-terminal", "konsole"].includes(program)) {
    return "truecolor";
  }
  if (term.includes("256")) return "ansi256";
  if (term === "" ) return "ansi16";
  return "ansi16";
}

function detectUnicode(env: NodeJS.ProcessEnv): boolean {
  // Degrading colors but not glyphs leaves a dumb terminal being told it can
  // draw Braille, which is the one thing it certainly cannot.
  const term = env.TERM ?? "";
  if (term === "dumb" || term === "linux") return false;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  if (/UTF-?8/i.test(locale)) return true;
  // Windows Terminal and modern emulators are UTF-8 regardless of locale vars.
  if (env.WT_SESSION || env.TERM_PROGRAM || env.KITTY_WINDOW_ID) return true;
  return process.platform === "win32" ? Boolean(env.WT_SESSION) : locale === "";
}

export function detectCapabilities(
  overrides: CapabilityOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
  stream: { isTTY?: boolean } = process.stdout,
): Capabilities {
  const tty = overrides.tty ?? Boolean(stream.isTTY);
  const term = env.TERM ?? "";
  const program = detectProgram(env);
  const tmux = Boolean(env.TMUX) || term.startsWith("tmux") || term.startsWith("screen");
  const screen = term.startsWith("screen") && !env.TMUX;
  const ssh = Boolean(env.SSH_CLIENT || env.SSH_TTY || env.SSH_CONNECTION);
  const colors = overrides.colors ?? detectColors(env, tty);
  const unicode = overrides.unicode ?? detectUnicode(env);

  const syncCapable =
    ["kitty", "wezterm", "ghostty", "iterm", "windows-terminal", "konsole", "alacritty"].includes(program) || tmux;

  return {
    tty,
    colors,
    trueColor: colors === "truecolor",
    unicode,
    braille: overrides.braille ?? (unicode && program !== "apple-terminal"),
    mouse: overrides.mouse ?? (tty && term !== "dumb" && term !== "linux"),
    synchronizedOutput: overrides.synchronizedOutput ?? (tty && syncCapable),
    bracketedPaste: tty && term !== "dumb",
    focusEvents: tty && term !== "dumb" && !screen,
    tmux,
    screen,
    ssh,
    windows: process.platform === "win32",
    program,
  };
}
