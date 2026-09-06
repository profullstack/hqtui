"""Native read-only Linux sensors. Explicit roots/command callback keep tests isolated."""
import json
import math
import re
from itertools import islice
from pathlib import Path


def read(path):
    try:
        with Path(path).open('rb') as stream:
            return stream.read(1024 * 1024).decode('utf-8', 'replace').strip()
    except (OSError, ValueError):
        return ''


def entries(path):
    try:
        return sorted(islice(Path(path).iterdir(), 4096))
    except OSError:
        return []


def finite(raw):
    try:
        value = float(raw)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def positive(raw):
    value = finite(raw)
    return value if value is not None and value > 0 else None


def parse_gpus(raw):
    result = []
    for line in raw.splitlines()[:16]:
        fields = [v.strip() for v in line.split(',')]
        if len(fields) != 6 or not fields[0]:
            continue
        row = dict(name=fields[0])
        for key, raw_value, scale in zip(
                ('utilization', 'memoryUsed', 'memoryTotal', 'temperature', 'power'),
                fields[1:], (.01, 1048576, 1048576, 1, 1)):
            value = finite(raw_value)
            row[key] = value * scale if value is not None and value >= 0 else None
        result.append(row)
    return result


def battery(sysroot):
    supplies = entries(sysroot / 'class/power_supply')[:128]
    ac = any(read(p / 'type') == 'Mains' and read(p / 'online') == '1' for p in supplies)
    for folder in supplies:
        if read(folder / 'type') != 'Battery':
            continue
        capacity = finite(read(folder / 'capacity'))
        if capacity is None or not 0 <= capacity <= 100:
            continue
        status = read(folder / 'status')
        watts = finite(read(folder / 'power_now'))
        if watts is not None:
            watts /= 1e6
        else:
            amps, volts = finite(read(folder / 'current_now')), finite(read(folder / 'voltage_now'))
            watts = amps * volts / 1e12 if amps is not None and volts is not None else None
        return dict(battery=capacity, charging=status == 'Charging', timeRemaining=status,
                    powerDraw=watts, acConnected=ac)
    return None


def collect(sysroot, cpuinfo, gpus=(), lm_sensors=lambda: None):
    sysroot = Path(sysroot)
    temps, rows = [], []
    for folder in entries(sysroot / 'class/hwmon')[:128]:
        chip = read(folder / 'name') or read(folder / 'device/name') or folder.name
        for base in (folder, folder / 'device'):
            for entry in entries(base):
                match = re.fullmatch(r'(temp|fan|in|power|curr)(\d+)_(input|average)', entry.name)
                if not match:
                    continue
                kind, index, suffix = match.groups()
                if suffix == 'average' and kind != 'power':
                    continue
                value = positive(read(entry))
                if value is None:
                    continue
                fallback = f'Fan {index}' if kind == 'fan' else kind + index
                label = read(base / f'{kind}{index}_label') or f'{chip} {fallback}'
                if kind == 'temp':
                    if value <= 150000 and len(temps) < 12:
                        maximum = (positive(read(base / f'temp{index}_crit')) or 100000) / 1000
                        temps.append(dict(label=label, value=value / 1000, max=maximum))
                elif len(rows) < 14:
                    formatted = {'fan': lambda: f'{math.floor(value + .5)} RPM',
                                 'in': lambda: f'{value / 1000:.2f} V',
                                 'power': lambda: f'{value / 1e6:.1f} W',
                                 'curr': lambda: f'{value / 1000:.2f} A'}[kind]()
                    rows.append(dict(label=label, value=formatted))
    if not temps:
        for folder in entries(sysroot / 'class/thermal')[:128]:
            value = positive(read(folder / 'temp'))
            if folder.name.startswith('thermal_zone') and value is not None and value <= 150000:
                temps.append(dict(label=read(folder / 'type') or folder.name, value=value / 1000, max=100))
                if len(temps) == 12:
                    break
    if not temps:
        try:
            chips = json.loads(lm_sensors() or '{}')
        except (ValueError, TypeError):
            chips = {}
        for chip, features in sorted(chips.items()) if isinstance(chips, dict) else ():
            for feature, values in sorted(features.items()) if isinstance(features, dict) else ():
                for key, value in sorted(values.items()) if isinstance(values, dict) else ():
                    if re.fullmatch(r'temp\d+_input', key) and isinstance(value, (int, float)) and 0 < value <= 150:
                        temps.append(dict(label=f'{chip.split("-")[0]} {feature}', value=value, max=100))
                        break
        temps = temps[:12]
    hardware_count = len(rows)
    power = battery(sysroot)
    if power:
        rows.append(dict(label='Battery', value=f'{power["battery"]:g}% ({power["timeRemaining"]})'))
        if power['powerDraw'] is not None and power['powerDraw'] > 0:
            rows.append(dict(label='Battery draw', value=f'{power["powerDraw"]:.1f} W'))
    for gpu in gpus[:16]:
        usage = f'{math.floor(gpu["utilization"] * 100 + .5)}%' if gpu.get('utilization') is not None else 'unavailable'
        temperature = f'{gpu["temperature"]:g}°C' if gpu.get('temperature') is not None else 'temperature unavailable'
        rows.append(dict(label=gpu['name'], value=f'{usage} · {temperature}'))
    clocks = []
    cpus = [p for p in entries(sysroot / 'devices/system/cpu') if re.fullmatch(r'cpu\d+', p.name)]
    for folder in sorted(cpus, key=lambda p: int(p.name[3:]))[:4]:
        value = positive(read(folder / 'cpufreq/scaling_cur_freq'))
        if value is not None:
            clocks.append(dict(label=f'{folder.name} clock', value=f'{value / 1e6:.2f} GHz'))
    if not clocks:
        for line in cpuinfo.splitlines():
            key, _, raw = line.partition(':')
            value = positive(raw)
            if key.strip() == 'cpu MHz' and value is not None:
                clocks.append(dict(label=f'cpu{len(clocks)} clock', value=f'{value / 1000:.2f} GHz'))
                if len(clocks) == 4:
                    break
    return dict(temperatures=temps, sensors=(rows + clocks)[:14], power=power, hardware_count=hardware_count)
