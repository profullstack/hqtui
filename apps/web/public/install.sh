#!/bin/sh
# Install the hqtui CLI (npm: @profullstack/hqtui): the widget showcase,
# `hqtui doctor` for terminal capabilities, and the OpenEmoji font installer.
#
#   curl -fsSL https://hqtui.com/install.sh | sh
#
# Uses bun if present, otherwise npm (Node >= 22.6). When the global npm
# prefix is not writable it installs into ~/.local instead of asking for sudo.
# Re-running it upgrades to the latest release.
set -eu

PKG="@profullstack/hqtui"
BIN="hqtui"

say() { printf '%s\n' "$*"; }
die() { printf 'hqtui install: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

say "Installing hqtui (High Quality Terminal UI)..."

if have bun; then
  bun add -g "$PKG@latest"
  BIN_DIR="${BUN_INSTALL:-$HOME/.bun}/bin"
elif have npm && have node; then
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=6)?0:1)' 2>/dev/null \
    || die "Node >= 22.6 required (found $(node -v)). Upgrade Node or install bun: https://bun.sh"
  prefix=$(npm config get prefix)
  modules="$prefix/lib/node_modules"
  [ -d "$modules" ] || modules="$prefix/lib"
  if [ -w "$modules" ] && [ -w "$prefix/bin" ]; then
    npm install -g "$PKG@latest"
    BIN_DIR="$prefix/bin"
  else
    BIN_DIR="$HOME/.local/bin"
    say "npm prefix $prefix is not writable; installing into $HOME/.local"
    npm install -g --prefix "$HOME/.local" "$PKG@latest"
  fi
else
  die "needs bun (https://bun.sh) or Node >= 22.6 with npm (https://nodejs.org)"
fi

say ""
if have "$BIN"; then
  say "hqtui $("$BIN" --version 2>/dev/null || echo '') installed."
else
  say "hqtui installed to $BIN_DIR, which is not on your PATH. Add it:"
  say "  export PATH=\"$BIN_DIR:\$PATH\""
fi
say ""
say "Next:"
say "  hqtui          # open the widget showcase"
say "  hqtui doctor   # what this terminal supports"
say "  hqtui --help   # every command"
say ""
say "Building an app? Add the library: bun add @profullstack/hqtui"
