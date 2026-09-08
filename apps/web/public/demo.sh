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
          'Languages: typescript (ts), rust, go, python, zig, cpp (c++), ruby, php, perl, cobol' \
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
        rust|go|python|zig|ruby|perl) tool=$language ;;
        php) tool=conda:php ;;
        cpp|c++) language=cpp; tool=cmake ;;
        # COBOL does not link against the library: it writes records that an
        # adapter renders, so the toolchain it needs is the adapter's.
        cob|cobol) language=cobol; tool=bun ;;
        *) fail "Unsupported language '$language'. Use typescript, rust, go, python, zig, cpp, ruby, php, perl or cobol. The C-only demo is not ready." ;;
    esac
    # When invoked through curl | sh, the pipe is not the demo's keyboard.
    # Connect only interactive runs to the controlling terminal; preserve pipes
    # for headless output. Do this before any update/build work.
    headless=$check
    # The COBOL demo prints its rendered widgets and exits; it never takes over
    # the terminal, so a pipe is a perfectly good destination for it.
    [ "$language" != cobol ] || headless=1
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
        case "$language" in rust) driver=cargo ;; typescript|cobol) driver=bun ;; python) driver=python3 ;; cpp) driver=cmake ;; *) driver=$language ;; esac
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
    # Compilers (including GCC's LTO subprocesses), Git and dependency installers
    # need scratch space too. /tmp may have a separate quota even when the build
    # filesystem has ample room. Keep build scratch on the demo-cache filesystem.
    caller_tmpdir_set=${TMPDIR+x}
    caller_tmpdir=${TMPDIR-}
    TMPDIR=$cache/tmp
    [ ! -L "$TMPDIR" ] || fail 'Refusing symlinked build scratch directory.'
    mkdir -p "$TMPDIR" || fail "Cannot create build scratch: $TMPDIR"
    [ -w "$TMPDIR" ] || fail "Build scratch is not writable: $TMPDIR"
    export TMPDIR
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
    version=$(awk -v key="$tool" '{name=$1; gsub(/"/, "", name)} name == key && $2 == "=" {gsub(/"/, "", $3); print $3; exit}' "$source/mise.toml")
    case "$version" in ''|*[!0-9.]*) fail "Invalid pinned $tool version in mise.toml." ;; esac
    tool_spec=$tool
    # Prebuilt PHP includes development headers for our small native adapter.
    [ "$language" != php ] || tool_spec=conda:php
    # What --mise installs is a pin, not a floor. Perl 5.40 and Ruby 3.3 build
    # these bindings perfectly well, and treating the pin as a requirement makes
    # --system useless on any machine that is not already pinned, which is most
    # of them. So fail only below the version the port itself says it needs, and
    # merely mention anything between that and the pin.
    #
    # Each floor is the one declared in that port's own manifest: go.mod,
    # Cargo.toml rust-version, pyproject.toml requires-python, hqtui.gemspec,
    # composer.json, Makefile.PL MIN_PERL_VERSION, CMakeLists.txt. Bun's is not
    # a preference: 1.3 cannot parse a lockfileVersion 2 bun.lock, drops the
    # lockfile, and then blames the repository for frozen-lockfile drift.
    # apps/demo/scripts/test-updater.py checks this table against those files.
    minimum=
    case "$language" in
        typescript|cobol) minimum=1.4.0 ;;
        rust) minimum=1.75 ;;
        go) minimum=1.22 ;;
        python) minimum=3.10 ;;
        zig) minimum=0.16.0 ;;
        cpp) minimum=3.20 ;;
        ruby) minimum=3.1 ;;
        php) minimum=8.1 ;;
        perl) minimum=5.20 ;;
    esac
    # Field-wise numeric comparison; absent trailing fields count as zero.
    version_ge() {
        awk -v have="$1" -v want="$2" 'BEGIN {
            n = split(have, a, "."); m = split(want, b, "."); if (m > n) n = m
            for (i = 1; i <= n; i++) {
                if (a[i] + 0 > b[i] + 0) exit 0
                if (a[i] + 0 < b[i] + 0) exit 1
            }
            exit 0
        }'
    }
    if [ "$manager" = system ]; then
        case "$language" in
            typescript|cobol|rust|python|cpp|ruby) installed=$("$driver_path" --version 2>/dev/null) ;;
            go|zig) installed=$("$driver_path" version 2>/dev/null) ;;
            php) installed=$("$driver_path" -r 'echo PHP_VERSION;' 2>/dev/null) ;;
            perl) installed=$("$driver_path" -e 'printf "%vd", $^V' 2>/dev/null) ;;
        esac
        # Every driver above prints its version as the first number on the first
        # line, whatever surrounds it ("go version go1.26.0", "cmake version 4.4.3").
        installed=$(printf '%s\n' "$installed" | sed -n '1s/[^0-9]*\([0-9][0-9.]*\).*/\1/p' | sed 's/\.*$//')
        [ -n "$installed" ] || fail "Cannot read the version of $driver_path. Use --mise to build against the pinned toolchain."
        if ! version_ge "$installed" "$minimum"; then
            fail "$driver_path is $installed, and this demo needs $driver $minimum or newer. Upgrade $driver, or rerun with --mise to build against the pinned $tool $version."
        fi
        if ! version_ge "$installed" "$version"; then
            note "Building with your $driver $installed; this revision pins $tool $version. Rerun with --mise if the build fails."
        fi
    fi
    run_tool() {
        if [ "$manager" = mise ]; then
            mise --no-config exec "$tool_spec@$version" -- "$@"
        else
            "$@"
        fi
    }
    launch() {
        cleanup; locked=0
        trap - EXIT INT TERM HUP
        # This is a build setting, not an override of the application's environment.
        if [ "$caller_tmpdir_set" = x ]; then TMPDIR=$caller_tmpdir; export TMPDIR; else unset TMPDIR; fi
        if [ "$manager" = mise ]; then
            exec mise --no-config exec "$tool_spec@$version" -- "$@"
        else
            exec "$@"
        fi
    }
    platform=$(uname -sm | tr ' /' '--')
    case "$platform" in ''|*[!a-zA-Z0-9_.-]*) fail 'Unsupported platform identifier.' ;; esac
    bins=$cache/bin/$platform/$manager-$tool-$version/$revision
    mkdir -p "$bins" "$cache/build"
    case "$language" in
        ruby|php|perl)
            case "$(uname -s)" in Linux) library_suffix=so ;; Darwin) library_suffix=dylib ;; *) fail 'These bindings currently support Linux/macOS.' ;; esac
            command -v "${CXX:-c++}" >/dev/null 2>&1 || fail 'A C++17 compiler (GCC/Clang) is required.'
            cmake_version=$(awk '$1 == "cmake" && $2 == "=" {gsub(/"/, "", $3); print $3; exit}' "$source/mise.toml")
            case "$cmake_version" in ''|*[!0-9.]*) fail 'Invalid CMake pin.' ;; esac
            cmake_driver=cmake
            cmake_via_mise=0
            if [ "$manager" = system ]; then
                if cmake_driver=$(command -v cmake 2>/dev/null); then
                    case "$cmake_driver" in */mise/shims/*) cmake_driver=$(mise which cmake) || fail 'Activate CMake or use --mise.' ;; esac
                elif command -v mise >/dev/null 2>&1; then
                    # CMake is a build tool for the native binding, not the
                    # language runtime this flag is about, and the C++ compiler
                    # still comes from the host. Borrowing the pinned CMake beats
                    # refusing to run on a machine that has everything else.
                    note "No system CMake; borrowing the pinned CMake $cmake_version through mise."
                    cmake_via_mise=1
                else
                    case "$(uname -s)" in
                        Darwin) fail 'CMake is needed to build the native binding. Install it with "brew install cmake", or install mise and rerun.' ;;
                        *) fail 'CMake is needed to build the native binding. Install it with your package manager (for example "apt install cmake"), or install mise and rerun.' ;;
                    esac
                fi
            fi
            binding_cmake() {
                if [ "$manager" = mise ] || [ "$cmake_via_mise" -eq 1 ]; then
                    mise --no-config exec "cmake@$cmake_version" -- cmake "$@"
                else
                    "$cmake_driver" "$@"
                fi
            }
            binding_identity=$language-$version
            php_config=
            if [ "$language" = php ]; then
                # Prefer the compiled adapter; a vanilla FFI-enabled PHP can
                # instead use the C ABI without PHP development headers.
                php_config=$(run_tool sh -c 'command -v php-config' 2>/dev/null) || php_config=
                php_version=$(run_tool php -r 'echo PHP_VERSION;')
                if [ -n "$php_config" ]; then
                    [ "$(run_tool "$php_config" --version)" = "$php_version" ] || fail 'php-config must match the selected PHP runtime. Fix PATH or use --mise.'
                fi
                php_abi=$(run_tool php -r 'echo PHP_VERSION, ":", PHP_ZTS, ":", PHP_DEBUG, ":", PHP_BINARY;' | git_safe hash-object --stdin)
                binding_identity=$binding_identity-$php_abi
                if [ -z "$php_config" ]; then
                    run_tool php -r 'exit(extension_loaded("ffi") ? 0 : 1);' || fail 'PHP needs php-config/development headers or its FFI extension.'
                fi
            fi
            binding_build=$cache/build/bindings/$platform/$manager/$binding_identity/$revision
            if [ ! -f "$binding_build/ready" ] || [ ! -f "$binding_build/libhqtui_bindings.$library_suffix" ]; then
                note "Building shared native renderer for $language (first run of this revision)…"
                binding_cmake -S "$source/ports/cpp" -B "$binding_build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF -DHQTUI_LTO=ON -DHQTUI_BUILD_BINDINGS=ON "-DHQTUI_PHP_CONFIG=$php_config" >&2
                binding_cmake --build "$binding_build" --target hqtui_bindings --parallel 2 >&2
                if [ -n "$php_config" ]; then binding_cmake --build "$binding_build" --target hqtui_php --parallel 2 >&2; fi
                printf '%s\n' "$revision" > "$binding_build/ready"
            fi
            HQTUI_NATIVE_LIB=$binding_build/libhqtui_bindings.$library_suffix
            export HQTUI_NATIVE_LIB
            case "$language" in
                ruby)
                    run_tool ruby -rfiddle/import -e '' || fail 'Ruby needs Fiddle (gem install fiddle).'
                    launch ruby "$source/ports/ruby/examples/dashboard.rb" "$@"
                    ;;
                php)
                    if [ -f "$binding_build/hqtui_php.so" ]; then
                        launch php -d "extension=$binding_build/hqtui_php.so" "$source/ports/php/examples/dashboard.php" "$@"
                    else
                        launch php "$source/ports/php/examples/dashboard.php" "$@"
                    fi
                    ;;
                perl)
                    perl_abi=$(run_tool perl -MConfig -e 'print "$^X:$Config{version}:$Config{archname}"' | git_safe hash-object --stdin)
                    perl_deps=$cache/deps/perl/$platform/$perl_abi-platypus-2.11
                    PERL5LIB=$perl_deps/lib/perl5${PERL5LIB:+:$PERL5LIB}; export PERL5LIB
                    if ! run_tool perl -MFFI::Platypus=2.11 -e '' 2>/dev/null; then
                        note 'Installing Perl FFI::Platypus into the private demo cache…'
                        if command -v cpanm >/dev/null 2>&1; then
                            run_tool cpanm --local-lib-contained "$perl_deps" --notest --mirror https://cpan.metacpan.org --mirror-only FFI::Platypus@2.11 >&2 \
                                || fail 'FFI::Platypus did not build. A C compiler and make are required. No global Perl modules were modified.'
                        else
                            # macOS ships Perl but no cpanm, which stopped
                            # --system perl before it built anything. Fetch the
                            # standalone installer into the private cache rather
                            # than asking for a manual step; nothing global and
                            # nothing outside the cache is touched.
                            cpanm_script=$cache/deps/perl/cpanm
                            if [ ! -f "$cpanm_script" ]; then
                                mkdir -p "$cache/deps/perl"
                                note 'No cpanm found; fetching the standalone installer from cpanmin.us into the demo cache…'
                                if command -v curl >/dev/null 2>&1; then
                                    curl -fsSL https://cpanmin.us -o "$cpanm_script.pending" || fail 'Could not download cpanm. Install cpanm, or use --mise.'
                                elif command -v wget >/dev/null 2>&1; then
                                    wget -qO "$cpanm_script.pending" https://cpanmin.us || fail 'Could not download cpanm. Install cpanm, or use --mise.'
                                else
                                    fail 'Fetching cpanm needs curl or wget. Install cpanm, or use --mise.'
                                fi
                                mv "$cpanm_script.pending" "$cpanm_script"
                            fi
                            run_tool perl "$cpanm_script" --local-lib-contained "$perl_deps" --notest --mirror https://cpan.metacpan.org --mirror-only FFI::Platypus@2.11 >&2 \
                                || fail 'FFI::Platypus did not build. A C compiler and make are required. No global Perl modules were modified.'
                        fi
                    fi
                    launch perl "$source/ports/perl/examples/dashboard.pl" "$@"
                    ;;
            esac
            ;;
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
        cobol)
            cd "$source"
            # No mise package provides a COBOL compiler, so this one is the
            # system's or nothing. Say what to install rather than failing with
            # "cobc: not found" from three frames down.
            command -v cobc >/dev/null 2>&1 || case "$(uname -s)" in
                Darwin) fail 'GnuCOBOL is required. Install it with "brew install gnu-cobol", then run this again.' ;;
                *) fail 'GnuCOBOL is required. Install it with your package manager (for example "apt install gnucobol4"), then run this again.' ;;
            esac
            if [ ! -f "$bins/cobol.ready" ] || [ ! -x "$bins/widgets" ]; then
                note 'Compiling the COBOL program and building the adapter (first run of this revision)…'
                run_tool bun install --frozen-lockfile --ignore-scripts
                run_tool bun run --bun build
                cobc -x -free "$source/ports/cobol/examples/widgets.cbl" -o "$bins/widgets" >&2
                printf '%s\n' "$revision" > "$bins/cobol.ready"
            fi
            # COBOL writes records; the adapter draws them. That pipe is the
            # whole design, so the demo runs it rather than hiding it.
            "$bins/widgets" > "$cache/tmp/cobol-records.txt"
            launch bun ports/cobol/adapter/render.ts < "$cache/tmp/cobol-records.txt"
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
