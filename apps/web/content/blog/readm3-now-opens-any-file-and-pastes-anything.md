---
title: "readm3 now opens any file, and pastes anything"
date: "2026-11-11"
description: "readm3 0.7.0 to 0.9.0: pastes of any language with a front door at readm3.com/paste, and an editor that opens any text file, PDF or image."
canonical: "https://dev.profullstack.com/~anthony/blog/192-post.html"
author: Anthony Ettinger
---

readm3 started as a Markdown reader, and until today that was a hard line: the editor would only import .md files, and a paste was a Markdown file by definition. The first thing people tried to paste was JSON. The first thing they tried to open was a folder full of code. Both are fixed, in 0.7.0, 0.8.0 and 0.9.0, shipped the same day.

## Pastes take any language, and have a front door

A paste is now whatever you pasted. Markdown still renders as a document. Everything else renders as code: JSON, JavaScript, TypeScript, Python, shell, YAML, HTML, CSS, SQL, Go, Rust, Java, C, Dockerfiles, diffs and some thirty languages in all, with syntax colors taken from the reader's own theme, line numbers, and folding. Click the arrow beside a line and its block collapses to `{ ⋯ 12 lines }`. Minified JSON is shown pretty-printed. A PDF or an image pastes too, and shows as itself.

You do not have to say what it is. If the file name has a known extension, that decides. If there is no name, because you piped something in, the content is sniffed: valid JSON is JSON, a shebang names its shell, a heading on the first line is Markdown, and a small classifier looks for two independent tell-tale constructs per language before it believes anything, so a note that happens to contain the word "select" does not become SQL.

The front door is https://readm3.com/paste: paste text or drop a file, pick how long the link lives, get the link. The same page opens any paste by its link, and shows the CLI, curl, API and MCP forms of the same thing, because the page is only a form over one endpoint:

    readm3 paste config.json                     # the name decides
    kubectl get pods -o yaml | readm3 paste      # YAML, nobody said so
    curl https://readm3.com/p/<token>/raw        # the text itself

No account, and none needed. Only the hash of the secret is stored, so nobody can list or find a paste, and whoever holds the link can read or delete it. Raw is always served as plain text, so a pasted HTML page can never run as readm3.com; `?download=1` sends the file with its own type. In the editor, the new Paste link button does it for the file you have open.

## The editor opens any viewable file

Open files, Open folder, drag-and-drop and Open URL now take any file a browser can show. A text file of any kind opens as the same highlighted, foldable code, and you can edit it with `e` like a note; the view re-renders when you leave the editor and the edit is saved on this device. A file with no extension is sniffed once on import and remembers what it is across reloads and sync.

PDFs and images open in the browser's own viewer, with an open-in-a-new-tab link and Download. Archives, executables, media and office files are skipped without being read, and so is anything that turns out to be binary once it is; the explorer tells you how many were left out and why. Hidden and build directories stay pruned as before.

## Same limits, same privacy

Nothing leaves the browser unless you choose Share or Paste link. Files are 4 MB each and 20 MB per workspace; a PDF counts as its base64 size. Pastes are 256 KB and expire after seven days by default.

Install with `npm i -g @profullstack/readm3`, open https://readm3.com/viewer, or paste at https://readm3.com/paste. Source: https://github.com/profullstack/readm3.
