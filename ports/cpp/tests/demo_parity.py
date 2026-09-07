"""C++ screen bodies versus the shared, unmodified TypeScript expectations."""
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
cases = json.loads((root / 'conformance/fixtures/demo-parity.json').read_text())
assert len(cases) == 120
for case in cases:
    command = [sys.argv[1], str(case['width']), str(case['height']),
               case['theme'], '--hashes', case['screen']]
    result = subprocess.run(command, capture_output=True, text=True, check=True, timeout=20)
    hashes = json.loads(result.stdout)
    assert hashes == case['hashes'], (case['screen'], case['theme'], case['width'],
                                     [i for i, (a, b) in enumerate(zip(hashes, case['hashes'])) if a != b])
print('C++: all 120 TypeScript reference frames match exactly (glyphs/colors/attributes).')
