# Markdown summary copy — 0.6.3

Summary panels and modals can export Markdown through a header copy icon.
Apps opt in with `copyMarkdown`; `markdownContext` carries the host, source and
reporting period. `copyButton` supports custom status strips. Tables, logs, trees,
lists, inputs and raw drawing callbacks are excluded from automatic summaries.

The TypeScript demo enables the feature. The corresponding Crawlproof and
CoinPay integrations require HQTUI 0.6.3 or later in the 0.6 series.

Release the HQTUI library before its demo and consumer packages, then regenerate
consumer lockfiles against the published tarball. Build the library and demo with
`bun run build`. Local testing can install all prepared package tarballs together
with `npm install --prefix <directory> <tarball-paths>`.

Validation covers semantic exports before clipping, nested panels and opt-outs,
ASCII and narrow headers, mouse and keyboard activation, modal dismissal,
clipboard failures, UTF-8 OSC 52 payloads and tmux wrapping. The installed demo
was also exercised in a PTY: Tab/Enter emitted a Markdown payload and q exited
cleanly. Terminal clipboard support must be enabled for OSC 52 delivery.
