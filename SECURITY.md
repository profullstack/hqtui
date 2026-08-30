# Security Policy

## Supported versions

HQTUI is pre-1.0. Security fixes land on the latest published release.

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/profullstack/hqtui/security/advisories/new)
or by emailing security@profullstack.com. Do not open a public issue.

We aim to acknowledge reports within 72 hours.

## Threat model

HQTUI is a rendering library with a deliberately small attack surface:

- it makes **no network requests** and contains no telemetry
- it spawns **no subprocesses** and reads no files
- it has **zero runtime dependencies**

The realistic risks are therefore in what it *writes to your terminal*. Untrusted text
passed to a widget is measured and clipped, never re-emitted as control sequences — if
you find input that escapes a cell, corrupts the surrounding grid, or injects an escape
sequence into stdout, that is a security bug and we want to hear about it.

`@profullstack/hqtui-demo` does execute read-only system commands (`ps`, `df`,
`vm_stat`, PowerShell CIM queries) to collect real metrics. It never passes user input
to a shell.
