#!/bin/sh
# HQTUI update-and-run launcher. Run only after reviewing/trusting this script.
# Source and builds live in a private cache, never in the caller's checkout.
# A complete function definition must arrive before the final invocation runs.
main() (
    set -eu
    umask 077
    fail() { printf 'hqtui-demo: %s\n' "$*" >&2; exit 1; }
    note() { printf 'hqtui-demo: %s\n' "$*" >&2; }
    usage() {
        printf '%s\n' 'Usage: demo.sh [--mise|--system] [--check] LANGUAGE [demo arguments...]' \
          'Languages: typescript (ts), rust, go, python, zig, cpp (c++)' \
          'Every invocation fetches latest main. --check prints the revision without building.' \
          'Defaults to mise when installed, otherwise uses your installed compiler/runtime.' \
          'Examples: demo.sh rust --sim; demo.sh --mise rust --snapshot'
    }
    manager=auto
    check=0
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --mise) manager=mise; shift ;;
            --system) manager=system; shift ;;
            --check) check=1; shift ;;
            --help|-h) usage; exit 0 ;;
            --) shift; break ;;
            *) break ;;
        esac
    done
    [ "$#" -gt 0 ] || { usage >&2; exit 2; }
    language=$1; shift
    case "$language" in
        ts|typescript) language=typescript; tool=bun ;;
        rust|go|python|zig) tool=$language ;;
        cpp|c++) language=cpp; tool=cmake ;;
        *) fail "Unsupported language '$language'. The C-only demo is not ready; use typescript, rust, go, python, zig or cpp." ;;
    esac
    # When invoked through curl | sh, the pipe is not the demo's keyboard.
    # Connect only interactive runs to the controlling terminal; preserve pipes
    # for headless output. Do this before any update/build work.
    headless=$check
    for argument in "$@"; do
        case "$argument" in --snapshot|--help|-h|--version|-V) headless=1 ;; esac
    done
    if [ "$headless" -eq 0 ]; then
        [ -t 1 ] || fail 'Interactive demo needs a terminal on stdout. Use --snapshot for native headless output.'
        if [ ! -t 0 ]; then
            ( : </dev/tty ) 2>/dev/null || fail 'No controlling terminal. Run this command in a terminal, or use --snapshot.'
            exec </dev/tty
        fi
    fi
    command -v git >/dev/null 2>&1 || fail 'Git is required. Install Git, then run the same command again.'
    if [ "$manager" = auto ]; then
        if command -v mise >/dev/null 2>&1; then manager=mise; else manager=system; fi
    fi
    if [ "$manager" = mise ]; then
        command -v mise >/dev/null 2>&1 || fail 'mise was requested but is not installed. Install mise or omit --mise.'
    fi
    if [ "$manager" = system ] && [ "$check" -eq 0 ]; then
        case "$language" in rust) driver=cargo ;; typescript) driver=bun ;; python) driver=python3 ;; cpp) driver=cmake ;; *) driver=$language ;; esac
        driver_path=$(command -v "$driver") || fail "$driver is not installed. Install it, or use --mise."
        # Resolve a mise shim BEFORE entering the fetched checkout. Vanilla must
        # not accidentally load or ask to trust the downloaded mise.toml. Keep the
        # resolved bin directory first for nested build commands (Bun, rustc).
        case "$driver_path" in
            */mise/shims/*|"${MISE_DATA_DIR:-/nonexistent}"/shims/*)
                driver_path=$(mise which "$driver") || fail "Cannot resolve installed $driver; try --mise."
                ;;
        esac
        case "$driver_path" in /*) ;; *) fail "Expected an executable path for $driver." ;; esac
        PATH=$(dirname "$driver_path"):$PATH
        export PATH
    fi
    base=${XDG_CACHE_HOME:-${HOME:?HOME must be set}/.cache}
    cache=${HQTUI_DEMO_CACHE:-$base/hqtui-demo}/v1
    case "$cache" in /*) ;; *) fail 'The cache location must be an absolute path.' ;; esac
    [ ! -L "$cache" ] || fail "Cache is a symlink: $cache"
    mkdir -p "$cache"
    lock=$cache/update.lock
    locked=0
    cleanup() {
        if [ "$locked" -eq 1 ]; then
            # Only remove the two lock entries created by this process.
            rm -f "$lock/pid"
            rmdir "$lock" || :
        fi
    }
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    trap 'exit 129' HUP
    waited=0
    while ! mkdir "$lock" 2>/dev/null; do
        # Do not guess whether another process or a crashed invocation owns it.
        # This also avoids PID-reuse and partially-created-lock races.
        [ "$waited" -ne 0 ] || note "Waiting for another updater ($lock)."
        [ "$waited" -lt 120 ] || fail "Updater lock is still present: $lock. Check for another build; if none is running, remove only this lock directory and retry."
        sleep 1
        waited=$((waited + 1))
    done
    locked=1
    printf '%s\n' "$$" > "$lock/pid"
    repository=https://github.com/profullstack/hqtui.git
    mirror=$cache/repository.git
    [ ! -L "$mirror" ] || fail 'Refusing a symlinked repository cache.'
    export GIT_TERMINAL_PROMPT=0
    git_safe() { git -c core.hooksPath=/dev/null "$@"; }
    if [ ! -e "$mirror" ]; then
        git_safe init --bare --quiet "$mirror"
        git_safe --git-dir="$mirror" remote add origin "$repository"
    fi
    [ "$(git_safe --git-dir="$mirror" rev-parse --is-bare-repository)" = true ] || fail 'Cache is not a bare repository.'
    [ "$(git_safe --git-dir="$mirror" config --get remote.origin.url)" = "$repository" ] || fail 'Cache remote is not the official HQTUI repository.'
    note 'Checking latest main…'
    # Never fall back to an old revision when offline or when fetch fails.
    git_safe --git-dir="$mirror" fetch --quiet --depth=1 origin '+refs/heads/main:refs/remotes/origin/main' \
        || fail 'Update failed; no cached demo was launched. Check the connection and retry.'
    revision=$(git_safe --git-dir="$mirror" rev-parse --verify 'refs/remotes/origin/main^{commit}')
    case "$revision" in ''|*[!0-9a-f]*) fail 'Invalid Git revision.' ;; esac
    note "$language · main $revision"
    if [ "$check" -eq 1 ]; then printf '%s\n' "$revision"; exit 0; fi
    sources=$cache/revisions
    [ ! -L "$sources" ] || fail 'Refusing symlinked source cache.'
    mkdir -p "$sources"
    source=$sources/$revision
    [ ! -L "$source" ] || fail 'Refusing symlinked source revision.'
    if [ ! -e "$source" ]; then
        git_safe --git-dir="$mirror" worktree add --quiet --detach "$source" "$revision"
    fi
    [ "$(git_safe -C "$source" rev-parse HEAD)" = "$revision" ] || fail 'Cached checkout has a different revision.'
    [ -z "$(git_safe -C "$source" status --porcelain --untracked-files=normal)" ] \
        || fail "Cached source was modified: $source. It has been left untouched; choose a new HQTUI_DEMO_CACHE location."
    # Read only the selected version string, not mise hooks or environment code.
    version=$(awk -v key="$tool" '$1 == key && $2 == "=" {gsub(/"/, "", $3); print $3; exit}' "$source/mise.toml")
    case "$version" in ''|*[!0-9.]*) fail "Invalid pinned $tool version in mise.toml." ;; esac
    run_tool() {
        if [ "$manager" = mise ]; then
            mise --no-config exec "$tool@$version" -- "$@"
        else
            "$@"
        fi
    }
    launch() {
        cleanup; locked=0
        trap - EXIT INT TERM HUP
        if [ "$manager" = mise ]; then
            exec mise --no-config exec "$tool@$version" -- "$@"
        else
            exec "$@"
        fi
    }
    platform=$(uname -sm | tr ' /' '--')
    case "$platform" in ''|*[!a-zA-Z0-9_.-]*) fail 'Unsupported platform identifier.' ;; esac
    bins=$cache/bin/$platform/$manager-$tool-$version/$revision
    mkdir -p "$bins" "$cache/build"
    case "$language" in
        cpp)
            case "$(uname -s)" in Linux|Darwin) ;; *) fail 'The C++ terminal demo currently supports Linux/macOS; use another demo on this platform.' ;; esac
            # mise manages CMake here. The native C/C++ compiler is supplied by
            # the host (GCC/Clang), not silently replaced or downloaded.
            command -v "${CXX:-c++}" >/dev/null 2>&1 || fail 'A C++17 compiler is required (GCC/Clang). Install your platform build tools, then rerun.'
            if [ ! -f "$bins/cpp.ready" ] || [ ! -x "$bins/cpp" ]; then
                note 'Building optimized C++ demo (first run of this revision)…'
                cpp_build=$cache/build/cpp/$platform/$manager/$revision
                run_tool cmake -S "$source/ports/cpp" -B "$cpp_build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF -DHQTUI_LTO=ON >&2
                run_tool cmake --build "$cpp_build" --target hqtui-demo-cpp --parallel 2 >&2
                cp "$cpp_build/hqtui-demo-cpp" "$bins/cpp.pending"
                mv "$bins/cpp.pending" "$bins/cpp"
                printf '%s\n' "$revision" > "$bins/cpp.ready"
            fi
            launch "$bins/cpp" "$@"
            ;;
        rust)
            cd "$source/ports/rust"
            if [ ! -f "$bins/rust.ready" ] || [ ! -x "$bins/rust" ]; then
                note 'Building optimized Rust demo (first run of this revision)…'
                CARGO_TARGET_DIR=$cache/build/rust; export CARGO_TARGET_DIR
                run_tool cargo build --release --example dashboard
                cp "$CARGO_TARGET_DIR/release/examples/dashboard" "$bins/rust.pending"
                mv "$bins/rust.pending" "$bins/rust"
                printf '%s\n' "$revision" > "$bins/rust.ready"
            fi
            launch "$bins/rust" "$@"
            ;;
        go)
            cd "$source/ports/go"
            if [ ! -f "$bins/go.ready" ] || [ ! -x "$bins/go" ]; then
                note 'Building Go demo (first run of this revision)…'
                run_tool go build -o "$bins/go" ./examples/dashboard
                printf '%s\n' "$revision" > "$bins/go.ready"
            fi
            launch "$bins/go" "$@"
            ;;
        python)
            cd "$source/ports/python"
            python=python3
            [ "$manager" != mise ] || python=python
            launch "$python" -B -m examples.dashboard "$@"
            ;;
        zig)
            cd "$source/ports/zig"
            if [ ! -f "$bins/zig.ready" ] || [ ! -x "$bins/zig/bin/hqtui-demo-zig" ]; then
                note 'Building optimized Zig demo (first run of this revision)…'
                run_tool zig build -Doptimize=ReleaseFast --prefix "$bins/zig"
                printf '%s\n' "$revision" > "$bins/zig.ready"
            fi
            launch "$bins/zig/bin/hqtui-demo-zig" "$@"
            ;;
        typescript)
            cd "$source"
            if [ ! -f "$bins/typescript.ready" ] || [ ! -f apps/demo/dist/main.js ]; then
                note 'Building current TypeScript demo (first run of this revision)…'
                run_tool bun install --frozen-lockfile --ignore-scripts
                # Keep nested tsc/build scripts on Bun too, even with Node
                # version-manager shims in PATH and an untrusted mise.toml.
                run_tool bun run --bun build
                printf '%s\n' "$revision" > "$bins/typescript.ready"
            fi
            launch bun apps/demo/dist/main.js "$@"
            ;;
    esac
)
main "$@"
