#!/bin/sh
# hqtui installer.
#
#   curl -fsSL https://hqtui.com/install.sh | sh
#
# Installs @profullstack/hqtui (commands: hqtui) under your home directory. No root, no system
# package manager, no system files touched. If this machine has no Node 22+,
# an official Node build is fetched (checksum verified) into the same private directory
# and used from there. Run this again to update. Remove with:
#   sh ~/.local/share/hqtui/uninstall.sh
#
#   sh -s -- --version X    install a specific release
#   sh -s -- --prefix DIR   install root (default: ~/.local)
#
# Listed in the W3BS catalog (https://w3bs.org/packages): `w3bs install hqtui` runs
# this same script and `w3bs update` re-runs it.
#
# Generated from the W3BS npm CLI installer template; keep the variables below in sync
# with package.json. Nothing runs until the last line, so a truncated download is inert.

main() {
  set -eu
  PKG="@profullstack/hqtui"
  TOOL="hqtui"
  URL="https://hqtui.com/install.sh"
  NODE_MAJOR="22"
  PREFIX="${INSTALL_PREFIX:-$HOME/.local}"
  VERSION=""
  NODE_CHOICE="${INSTALL_NODE:-auto}"

  while [ $# -gt 0 ]; do
    case "$1" in
      --version) VERSION="${2:?--version needs a value}"; shift ;;
      --prefix) PREFIX="${2:?--prefix needs a value}"; shift ;;
      -h | --help) echo "Usage: curl -fsSL $URL | sh [-s -- --version X --prefix DIR]"; return 0 ;;
      *) echo "$TOOL installer: unknown option $1" >&2; return 64 ;;
    esac
    shift
  done

  say() { printf '%s\n' "$*"; }
  fail() { printf '%s installer: %s\n' "$TOOL" "$*" >&2; exit 1; }

  case "$(uname -s)" in
    Linux) OS=linux ;;
    Darwin) OS=darwin ;;
    *) fail "unsupported operating system $(uname -s); Linux and macOS are supported" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) ARCH=x64 ;;
    aarch64 | arm64) ARCH=arm64 ;;
    *) fail "unsupported CPU $(uname -m)" ;;
  esac
  if command -v curl >/dev/null 2>&1; then
    fetch() { curl --proto '=https' --tlsv1.2 -fsSL "$1" -o "$2"; }
  elif command -v wget >/dev/null 2>&1; then
    fetch() { wget --https-only -q "$1" -O "$2"; }
  else
    fail "curl or wget is required"
  fi

  SHARE="$PREFIX/share/$TOOL"
  BIN="$PREFIX/bin"
  mkdir -p "$SHARE" "$BIN"

  node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
  NODE=""
  NODE_KIND=""
  if [ "$NODE_CHOICE" != private ] && command -v node >/dev/null 2>&1 && [ "$(node_major node)" -ge "$NODE_MAJOR" ]; then
    NODE="$(command -v node)"
    NODE_KIND=system
  elif [ -x "$SHARE/node/bin/node" ] && [ "$(node_major "$SHARE/node/bin/node")" -ge "$NODE_MAJOR" ]; then
    NODE="$SHARE/node/bin/node"
    NODE_KIND=private
  fi
  if [ -z "$NODE" ]; then
    say "No Node $NODE_MAJOR+ here; fetching an official Node 24 into $SHARE/node ..."
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    fetch "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt" "$TMP/SHASUMS256.txt" || fail "cannot reach nodejs.org"
    TARBALL="$(grep -o "node-v24\.[0-9.]*-$OS-$ARCH\.tar\.gz" "$TMP/SHASUMS256.txt" | head -n 1 || true)"
    [ -n "$TARBALL" ] || fail "nodejs.org has no Node 24 build for $OS-$ARCH"
    fetch "https://nodejs.org/dist/latest-v24.x/$TARBALL" "$TMP/$TARBALL" || fail "cannot download $TARBALL"
    if command -v sha256sum >/dev/null 2>&1; then SUM="$(sha256sum "$TMP/$TARBALL" | cut -d ' ' -f 1)"
    else SUM="$(shasum -a 256 "$TMP/$TARBALL" | cut -d ' ' -f 1)"; fi
    grep -q "^$SUM  $TARBALL\$" "$TMP/SHASUMS256.txt" || fail "checksum mismatch for $TARBALL"
    rm -rf "$SHARE/node" && mkdir -p "$SHARE/node"
    tar -xzf "$TMP/$TARBALL" -C "$SHARE/node" --strip-components=1 || fail "cannot unpack $TARBALL"
    NODE="$SHARE/node/bin/node"
    NODE_KIND=private
  fi
  if [ "$NODE_KIND" = private ]; then NPM="$SHARE/node/bin/npm"; else NPM="$(dirname "$NODE")/npm"; [ -x "$NPM" ] || NPM=npm; fi
  # npm runs package scripts with the Node in PATH; make that the chosen one.
  PATH="$(dirname "$NODE"):$PATH"
  export PATH

  SPEC="$PKG"
  [ -n "$VERSION" ] && SPEC="$PKG@$VERSION"
  say "Installing $SPEC into $SHARE ..."
  rm -rf "$SHARE/node_modules" "$SHARE/package.json" "$SHARE/package-lock.json"
  cd "$SHARE"
  printf '{ "name": "%s-install", "private": true }\n' "$TOOL" > package.json
  "$NPM" install --silent --no-audit --no-fund --omit=dev "$SPEC" >/dev/null 2>&1 ||
    "$NPM" install --no-audit --no-fund --omit=dev "$SPEC" || fail "npm could not install $SPEC"
  PKG_DIR="$SHARE/node_modules/$PKG"
  [ -f "$PKG_DIR/package.json" ] || fail "$SPEC installed but $PKG_DIR is missing"

  # One shim per entry in the package's own `bin` map: a script, not a symlink, so the
  # command always runs this copy with the chosen Node.
  BINS="$("$NODE" -e '
    const p = require(process.argv[1] + "/package.json");
    const b = typeof p.bin === "string" ? { [p.name.split("/").pop()]: p.bin } : (p.bin || {});
    for (const [k, v] of Object.entries(b)) if (/^[A-Za-z0-9._-]+$/.test(k)) console.log(k + "\t" + v);
  ' "$PKG_DIR")"
  [ -n "$BINS" ] || fail "$SPEC declares no commands"
  PATHS="$SHARE"
  NAMES=""
  OLDIFS="$IFS"
  IFS='
'
  for line in $BINS; do
    name="${line%%	*}"
    rel="${line#*	}"
    entry="$PKG_DIR/$rel"
    [ -f "$entry" ] || fail "$SPEC is missing $rel"
    printf '#!/bin/sh\n# %s, installed by the %s installer (%s).\nexec "%s" "%s" "$@"\n' "$name" "$TOOL" "$URL" "$NODE" "$entry" > "$BIN/$name"
    chmod 0755 "$BIN/$name"
    PATHS="$PATHS
$BIN/$name"
    NAMES="$NAMES $name"
  done
  IFS="$OLDIFS"

  INSTALLED="$("$NODE" -p "require('$PKG_DIR/package.json').version" 2>/dev/null || echo unknown)"
  {
    printf '{\n  "package": "%s",\n  "version": "%s",\n  "installer": "%s",\n' "$PKG" "$INSTALLED" "$URL"
    printf '  "installedAt": "%s",\n  "node": "%s",\n  "paths": [\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$NODE_KIND"
    printf '%s\n' "$PATHS" | sed 's/.*/    "&",/' | sed '$ s/,$//'
    printf '  ]\n}\n'
  } > "$SHARE/manifest.json"
  {
    echo '#!/bin/sh'
    echo "# Removes $TOOL. Written by its installer."
    echo 'set -eu'
    printf '%s\n' "$PATHS" | sed 's|.*|rm -rf "&"|'
    echo "echo '$TOOL removed.'"
  } > "$SHARE/uninstall.sh"
  chmod 0755 "$SHARE/uninstall.sh"

  say ""
  say "Installed $PKG $INSTALLED:$NAMES (in $BIN)"
  case ":$PATH:" in
    *":$BIN:"*) ;;
    *) say "Add $BIN to your PATH:  echo 'export PATH=\"$BIN:\$PATH\"' >> ~/.profile" ;;
  esac
  say "Update by running the installer again; remove with: sh $SHARE/uninstall.sh"
}

main "$@"
