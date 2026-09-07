"""Hermetic update-and-run integration tests against real local Git revisions.

Git's per-process URL rewrite maps the fixed official URL to a temporary fixture.
No network, remote writes, installed packages, or caller checkouts are modified.
"""
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[3]
LAUNCHER = ROOT / "apps/web/public/demo.sh"

class Updater(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="hqtui-updater-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "upstream"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Updater Test")
        self.git("config", "user.email", "test@example.invalid")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.env = {**os.environ, "HQTUI_DEMO_CACHE": str(self.root / "cache"),
                    "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": f"url.{self.repo}.insteadOf",
                    "GIT_CONFIG_VALUE_0": "https://github.com/profullstack/hqtui.git",
                    "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
                    "UPDATER_TEST_LOG": str(self.root / "tools.jsonl")}
        self.first = self.commit("first")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.repo, stderr=subprocess.DEVNULL, text=True).strip()

    def commit(self, label):
        # The Python demo runs the caller's own python3, so pin that exact
        # version: these tests cover updating and caching, not the version gate,
        # and must not depend on how new the host interpreter happens to be.
        host = subprocess.check_output(["python3", "--version"], text=True).split()[-1]
        (self.repo / "mise.toml").write_text(f'[tools]\nbun = "1.4.0"\npython = "{host}"\nrust = "1.97.1"\ngo = "1.26.0"\nzig = "0.16.0"\ncmake = "4.4.3"\nruby = "4.0.6"\n"conda:php" = "8.5.9"\nperl = "5.44.0.0"\n')
        (self.repo / ".gitignore").write_text('__pycache__/\ndist/\n')
        path = self.repo / "ports/python/examples"
        path.mkdir(parents=True, exist_ok=True)
        (path / "__init__.py").write_text("")
        (path / "dashboard.py").write_text(
            'import json, os, sys\n'
            f'print(json.dumps({{"revision": {label!r}, "args": sys.argv[1:], "cwd": os.getcwd(), "tty": os.isatty(0), "tmpdir": os.environ.get("TMPDIR")}}), flush=True)\n'
            'if "--wait" in sys.argv: input()\n')
        for language in ("typescript", "rust", "go", "zig", "cpp", "ruby", "php", "perl"):
            (self.repo / "ports" / language).mkdir(exist_ok=True)
            (self.repo / "ports" / language / "source").write_text(label)
        self.git("add", ".")
        self.git("commit", "-m", label)
        return self.git("rev-parse", "HEAD")

    def run_demo(self, *args, env=None, timeout=20):
        return subprocess.run(["sh", str(LAUNCHER), *args], cwd=ROOT,
                              env=env or self.env, capture_output=True, text=True, timeout=timeout)

    def test_latest_revision_updates_without_touching_caller(self):
        before = subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT)
        one = self.run_demo("--system", "python", "--snapshot", "literal argument", "$(not-a-command)")
        self.assertEqual(one.returncode, 0, one.stderr)
        self.assertEqual(json.loads(one.stdout)["revision"], "first")
        self.assertEqual(json.loads(one.stdout)["args"][-2:], ["literal argument", "$(not-a-command)"])
        second = self.commit("second")
        two = self.run_demo("--system", "python", "--snapshot")
        self.assertEqual(two.returncode, 0, two.stderr)
        self.assertEqual(json.loads(two.stdout)["revision"], "second")
        self.assertIn(second, two.stderr)
        self.assertIn(second, json.loads(two.stdout)["cwd"])
        self.assertNotEqual(self.first, second)
        self.assertEqual(before, subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT))

    def test_fetch_failure_never_launches_cached_source(self):
        self.assertEqual(self.run_demo("--system", "python", "--snapshot").returncode, 0)
        broken = {**self.env, "GIT_CONFIG_KEY_0": f"url.{self.root / 'missing'}.insteadOf"}
        result = self.run_demo("--system", "python", "--snapshot", env=broken)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no cached demo was launched", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_modified_cache_is_preserved_and_rejected(self):
        result = self.run_demo("--system", "python", "--snapshot")
        self.assertEqual(result.returncode, 0, result.stderr)
        path = self.root / "cache/v1/revisions" / self.first / "ports/python/examples/dashboard.py"
        path.write_text("# local edit\n")
        result = self.run_demo("--system", "python", "--snapshot")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Cached source was modified", result.stderr)
        self.assertEqual(path.read_text(), "# local edit\n")

    def test_check_only_reports_fetched_commit(self):
        result = self.run_demo("--system", "--check", "rust")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), self.first)
        self.assertFalse((self.root / "cache/v1/revisions").exists())

    def test_invalid_language_and_missing_terminal_fail_before_fetch(self):
        for args in (("--system", "c"), ("--system", "python")):
            result = self.run_demo(*args)
            self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "cache").exists())

    def stub_compilers(self):
        code = '''#!/usr/bin/env python3
import json, os, pathlib, sys, tempfile
tool=pathlib.Path(sys.argv[0]).name
args=sys.argv[1:]
with open(os.environ["UPDATER_TEST_LOG"],"a") as log: log.write(json.dumps([tool,*args])+"\\n")
pins={'bun':'1.4.0','cargo':'1.97.1','go':'1.26.0','zig':'0.16.0','cmake':'4.4.3','ruby':'4.0.6','perl':'5.44.0.0'}
reported=os.environ.get('UPDATER_'+tool.upper()+'_VERSION',pins.get(tool,''))
# The launcher probes each system tool before building. Answer in the shape the
# real tool answers: a bare number, or a number buried in a sentence.
if tool!='php-config' and (args[:1]==['--version'] or (tool in ('go','zig') and args[:1]==['version'])):
    print({'cargo':'cargo %s (fixture 2026-01-01)','go':'go version go%s linux/amd64',
           'cmake':'cmake version %s','ruby':'ruby %s (fixture revision)'}.get(tool,'%s')%reported)
    sys.exit(0)
if tool=='perl' and args[:1]==['-e'] and '$^V' in args[1]:
    print('.'.join(reported.split('.')[:3]),end='') # Perl reports three fields; mise pins four.
    sys.exit(0)
if tool in ('cmake','cargo','go','zig'):
    expected=pathlib.Path(os.environ['HQTUI_DEMO_CACHE'])/'v1/tmp'
    assert pathlib.Path(os.environ['TMPDIR'])==expected, 'compiler scratch escaped demo cache'
    with tempfile.TemporaryFile(dir=os.environ['TMPDIR']) as scratch: scratch.write(b'compiler scratch')
    if os.environ.get('UPDATER_FAIL_BUILD')=='1' and tool=='cmake' and args[0]=='--build':
        print('fixture linker failure',file=sys.stderr);sys.exit(1)
if tool=="mise":
    assert args[0:2]==["--no-config","exec"]
    assert args[3]=="--"
    os.execvp(args[4],args[4:])
elif tool in ("ruby","php","perl"):
    if args[0]=="-r":
        if args[1].startswith('echo PHP_VERSION'): print(os.environ.get('UPDATER_PHP_VERSION','8.5.9'))
        sys.exit(0)
    if args[0] in ("-rfiddle/import","-MFFI::Platypus=2.11"): sys.exit(0)
    if args[0]=="-MConfig": print("fixture-perl-abi");sys.exit(0)
    if args[0]=="-d": args=args[2:]
    label=(pathlib.Path(args[0]).parents[1]/"source").read_text()
    print(json.dumps(dict(revision=label,args=args[1:])))
    sys.exit(0)
elif tool=="php-config": print(os.environ.get('UPDATER_PHP_CONFIG_VERSION',os.environ.get('UPDATER_PHP_VERSION','8.5.9')));sys.exit(0)
elif tool=="bun":
    scratch=pathlib.Path(os.environ['HQTUI_DEMO_CACHE'])/'v1/tmp'
    if args[0]=="install":
        assert args==["install","--frozen-lockfile","--ignore-scripts"]
        assert pathlib.Path(os.environ['TMPDIR'])==scratch, 'install scratch escaped demo cache'
        sys.exit(0)
    if args[0]=="run":
        assert args==["run","--bun","build"]
        assert pathlib.Path(os.environ['TMPDIR'])==scratch, 'build scratch escaped demo cache'
        built=pathlib.Path("apps/demo/dist/main.js")
        built.parent.mkdir(parents=True,exist_ok=True)
        built.write_text(pathlib.Path("ports/typescript/source").read_text())
        sys.exit(0)
    print(json.dumps(dict(revision=pathlib.Path(args[0]).read_text(),args=args[1:])))
    sys.exit(0)
elif tool=="cargo":
    assert args==["build","--release","--example","dashboard"]
    output=pathlib.Path(os.environ["CARGO_TARGET_DIR"])/"release/examples/dashboard"
elif tool=="go":
    assert args[0:2]==["build","-o"] and args[3]=="./examples/dashboard"
    output=pathlib.Path(args[2])
elif tool=="zig":
    assert args[0:3]==["build","-Doptimize=ReleaseFast","--prefix"]
    output=pathlib.Path(args[3])/"bin/hqtui-demo-zig"
elif tool=="cmake":
    if args[0]=="-S":
        source=pathlib.Path(args[1]); build=pathlib.Path(args[3])
        build.mkdir(parents=True,exist_ok=True)
        (build/"source").write_text((source/"source").read_text())
        sys.exit(0)
    if args[0]=="--build" and args[3] in ("hqtui_bindings","hqtui_php"):
        build=pathlib.Path(args[1])
        for name in ('libhqtui_bindings.so','libhqtui_bindings.dylib','hqtui_php.so'):
            (build/name).write_text('fixture shared library')
        sys.exit(0)
    assert args[0]=="--build" and args[2:4]==["--target","hqtui-demo-cpp"]
    output=pathlib.Path(args[1])/"hqtui-demo-cpp"
else: raise AssertionError(tool)
label=(pathlib.Path(args[1])/"source" if tool=="cmake" else pathlib.Path("source")).read_text()
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text("#!/usr/bin/env python3\\nimport json,sys\\nprint(json.dumps(dict(revision="+repr(label)+",args=sys.argv[1:])))\\n")
output.chmod(0o700)
'''
        for name in ("mise", "bun", "cargo", "go", "zig", "cmake", "ruby", "php", "perl", "php-config"):
            path = self.bin / name
            path.write_text(code)
            path.chmod(0o700)

    def test_vanilla_and_mise_build_latest_and_reuse_only_same_revision(self):
        self.stub_compilers()
        for manager in ("--system", "--mise"):
            for language in ("rust", "go", "zig", "cpp"):
                result = self.run_demo(manager, language, "--snapshot", "argument with spaces")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)["revision"], "first")
                self.assertEqual(json.loads(result.stdout)["args"][-1], "argument with spaces")
        log = [json.loads(line) for line in (self.root / "tools.jsonl").read_text().splitlines()]
        self.assertEqual(sum(row[:2] in (["cargo","build"],["go","build"],["zig","build"],["cmake","--build"]) for row in log), 8)
        for language in ("rust", "go", "zig", "cpp"):
            self.assertEqual(self.run_demo("--mise", language, "--snapshot").returncode, 0)
        self.commit("second")
        for language in ("rust", "go", "zig", "cpp"):
            result = self.run_demo("--mise", language, "--snapshot")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["revision"], "second")
        log = [json.loads(line) for line in (self.root / "tools.jsonl").read_text().splitlines()]
        self.assertEqual(sum(row[:2] in (["cargo","build"],["go","build"],["zig","build"],["cmake","--build"]) for row in log), 12)

    def test_typescript_installs_and_builds_once_per_revision(self):
        self.stub_compilers()
        def installs():
            return sum(json.loads(line)[:2] == ["bun", "install"]
                       for line in (self.root / "tools.jsonl").read_text().splitlines())
        for manager in ("--system", "--mise"):
            result = self.run_demo(manager, "typescript", "--snapshot", "literal argument")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout),
                             dict(revision="first", args=["--snapshot", "literal argument"]))
        self.assertEqual(installs(), 2)
        self.assertEqual(self.run_demo("--mise", "typescript", "--snapshot").returncode, 0)
        self.assertEqual(installs(), 2) # Same revision: the earlier build is reused.
        self.commit("second")
        result = self.run_demo("--mise", "typescript", "--snapshot")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["revision"], "second")
        self.assertEqual(installs(), 3)

    def test_system_tool_below_the_floor_fails_before_any_build(self):
        self.stub_compilers()
        # Each entry is a different probe shape: `bun --version`, `go version`,
        # and Perl's own $^V. Bun 1.3 is the real case: it cannot read this
        # repository's lockfile and would otherwise report frozen-lockfile drift.
        for language, tool, old, need in (("typescript", "BUN", "1.3.14", "bun 1.4.0"),
                                          ("go", "GO", "1.20.0", "go 1.22"),
                                          ("perl", "PERL", "5.18.0.0", "perl 5.20")):
            result = self.run_demo("--system", language, "--snapshot",
                                   env={**self.env, f"UPDATER_{tool}_VERSION": old})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(f"needs {need} or newer", result.stderr)
            self.assertIn(f"is {old.rsplit('.', 1)[0] if tool == 'PERL' else old}", result.stderr)
            self.assertIn("--mise", result.stderr)
            self.assertEqual(result.stdout, "")
        log = (self.root / "tools.jsonl").read_text()
        self.assertNotIn('"install"', log)
        self.assertNotIn('"build"', log)
        # A newer system tool is fine, and --mise remains the documented way out.
        newer = self.run_demo("--system", "typescript", "--snapshot",
                              env={**self.env, "UPDATER_BUN_VERSION": "1.5.0"})
        self.assertEqual(newer.returncode, 0, newer.stderr)
        pinned = self.run_demo("--mise", "typescript", "--snapshot",
                               env={**self.env, "UPDATER_BUN_VERSION": "1.3.14"})
        self.assertEqual(pinned.returncode, 0, pinned.stderr)

    def test_system_tool_between_the_floor_and_the_pin_builds_with_a_note(self):
        # The regression this guards: treating the mise pin as a requirement
        # refused every stock Mac, where Perl is 5.34 and Ruby 3.3 against pins
        # of 5.44 and 4.0. Those build the bindings perfectly well.
        self.stub_compilers()
        for language, tool, have, pin in (("perl", "PERL", "5.34.0.0", "perl 5.44.0.0"),
                                          ("ruby", "RUBY", "3.3.8", "ruby 4.0.6"),
                                          ("go", "GO", "1.23.0", "go 1.26.0")):
            result = self.run_demo("--system", language, "--snapshot",
                                   env={**self.env, f"UPDATER_{tool}_VERSION": have})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(f"pins {pin}", result.stderr)
            self.assertIn("Rerun with --mise if the build fails", result.stderr)

    def test_declared_floors_match_the_ports_own_manifests(self):
        """The floors in demo.sh are copies. This is what stops them drifting.

        Each one is stated by the port itself; if a port raises its requirement
        and nobody updates the launcher, the launcher will happily start a build
        that cannot succeed.
        """
        launcher = LAUNCHER.read_text()
        declared = dict(re.findall(r"^\s+(\w+)\) minimum=([0-9.]+) ;;", launcher, re.M))
        manifests = {
            "go": (ROOT / "ports/go/go.mod", r"^go\s+([0-9.]+)"),
            "rust": (ROOT / "ports/rust/Cargo.toml", r'rust-version\s*=\s*"([0-9.]+)"'),
            "python": (ROOT / "ports/python/pyproject.toml", r'requires-python\s*=\s*">=\s*([0-9.]+)"'),
            "ruby": (ROOT / "ports/ruby/hqtui.gemspec", r"required_ruby_version\s*=\s*'>=\s*([0-9.]+)'"),
            "php": (ROOT / "ports/php/composer.json", r'"php":\s*">=\s*([0-9.]+)"'),
            "cpp": (ROOT / "ports/cpp/CMakeLists.txt", r"cmake_minimum_required\(VERSION ([0-9.]+)"),
        }
        for language, (path, pattern) in manifests.items():
            match = re.search(pattern, path.read_text(), re.M)
            self.assertIsNotNone(match, f"no version found in {path}")
            self.assertEqual(declared.get(language), match.group(1),
                             f"demo.sh says {language} needs {declared.get(language)}, "
                             f"but {path.name} says {match.group(1)}")
        # Perl's manifest writes 5.020, which is 5.20.
        perl = re.search(r"MIN_PERL_VERSION\s*=>\s*'([0-9.]+)'",
                         (ROOT / "ports/perl/Makefile.PL").read_text())
        self.assertIsNotNone(perl)
        self.assertEqual(declared.get("perl"),
                         re.sub(r"\.0*(\d)", r".\1", perl.group(1)))
        # Bun's floor is not a preference; it is what can read a v2 lockfile.
        self.assertEqual(declared.get("typescript"), "1.4.0")
        self.assertIn('"lockfileVersion": 2', (ROOT / "bun.lock").read_text())

    def test_bindings_update_both_managers_and_keep_builds_outside_source(self):
        self.stub_compilers()
        for manager in ('--system', '--mise'):
            for language in ('ruby', 'php', 'perl'):
                result=self.run_demo(manager,language,'--snapshot','literal argument')
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(json.loads(result.stdout),dict(revision='first',args=['--snapshot','literal argument']))
        def builds():
            return sum(json.loads(line)[:2]==['cmake','--build'] for line in (self.root/'tools.jsonl').read_text().splitlines())
        count=builds()
        self.assertEqual(count,8) # engine × three languages, plus PHP adapter; two managers
        for language in ('ruby','php','perl'):
            self.assertEqual(self.run_demo('--mise',language,'--version').returncode,0)
        self.assertEqual(builds(),count)
        self.commit('second')
        for language in ('ruby','php','perl'):
            result=self.run_demo('--mise',language,'--snapshot')
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(result.stdout)['revision'],'second')
        self.assertEqual(builds(),count+4)
        self.assertFalse((self.root/'cache/v1/update.lock').exists())

    def test_failed_binding_build_retries_with_private_scratch_without_ready_marker(self):
        self.stub_compilers()
        poisoned={**self.env,'TMPDIR':str(self.root/'unusable-global-tmp')}
        failed=self.run_demo('--mise','ruby','--snapshot',env={**poisoned,'UPDATER_FAIL_BUILD':'1'})
        self.assertNotEqual(failed.returncode,0)
        self.assertIn('fixture linker failure',failed.stderr)
        self.assertEqual(list((self.root/'cache/v1/build').rglob('ready')),[])
        self.assertFalse((self.root/'cache/v1/update.lock').exists())
        for manager in ['--mise','--system']:
            for language in ['ruby','php','perl','cpp','rust','go','zig']:
                result=self.run_demo(manager,language,'--snapshot',env=poisoned)
                self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue((self.root/'cache/v1/tmp').is_dir())
        self.assertFalse((self.root/'unusable-global-tmp').exists())

    def test_build_scratch_does_not_change_the_runtime_environment(self):
        for value in [None,str(self.root/'caller-temp')]:
            env={**self.env}
            if value is None: env.pop('TMPDIR',None)
            else: env['TMPDIR']=value
            result=self.run_demo('--system','python','--snapshot',env=env)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(result.stdout)['tmpdir'],value)

    def test_php_upgrade_rebuilds_adapter_and_mismatched_headers_are_rejected(self):
        self.stub_compilers()
        first=self.run_demo('--system','php','--version')
        self.assertEqual(first.returncode,0,first.stderr)
        def builds():
            return sum(json.loads(line)[:2]==['cmake','--build'] for line in
                       (self.root/'tools.jsonl').read_text().splitlines())
        self.assertEqual(builds(),2)
        upgraded={**self.env,'UPDATER_PHP_VERSION':'8.6.0'}
        result=self.run_demo('--system','php','--version',env=upgraded)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(builds(),4)
        bad={**upgraded,'UPDATER_PHP_CONFIG_VERSION':'8.5.9'}
        result=self.run_demo('--system','php','--version',env=bad)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('php-config must match',result.stderr)
        self.assertEqual(result.stdout,'')
        self.assertEqual(builds(),4)

    @unittest.skipUnless(os.name == "posix", "requires a controlling PTY")
    def test_pipe_launcher_reattaches_keyboard_and_releases_build_lock(self):
        pid, master = pty.fork()
        if pid == 0:
            # Like curl | sh: the script arrives on a pipe, not stdin's TTY.
            os.execvpe("sh", ["sh", "-c", 'cat "$1" | sh -s -- --system python --wait', "test", str(LAUNCHER)], self.env)
        output = b""
        done = False
        deadline = time.monotonic() + 15
        try:
            while time.monotonic() < deadline:
                if select.select([master], [], [], .1)[0]:
                    try: output += os.read(master, 65536)
                    except OSError: break
                if b'"tty": true' in output:
                    self.assertFalse((self.root / "cache/v1/update.lock").exists())
                    os.write(master, b"q\n")
                    done = True
                    break
            self.assertTrue(done, output.decode(errors="replace"))
        finally:
            if not done:
                os.killpg(pid, signal.SIGTERM)
            os.waitpid(pid, 0)
            os.close(master)

if __name__ == "__main__":
    unittest.main()
