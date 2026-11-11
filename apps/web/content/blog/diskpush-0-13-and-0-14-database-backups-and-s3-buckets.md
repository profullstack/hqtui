---
title: "DiskPush 0.13 and 0.14: database backups and S3 buckets"
date: "2026-11-11"
description: "DiskPush now dumps Postgres, Supabase, MySQL and SQLite to verified, tagged backups, and pushes to any S3-compatible bucket like it was a server."
canonical: "https://dev.profullstack.com/~anthony/blog/242-post.html"
author: Anthony Ettinger
---

DiskPush is our rsync desktop app and CLI. Two releases this week turn it into a backup tool as well: it now dumps your databases, and it now pushes to S3.

## Database backups (0.13)

A new built-in plugin, `diskpush dbbackup`, dumps Postgres, Supabase, MySQL/MariaDB and SQLite:

```
diskpush dbbackup add shop --kind postgres --tags prod --push backup@nas:/srv/db
diskpush dbbackup run --tags nightly
diskpush dbbackup restore shop --to-env STAGING_URL
```

- The file name is the catalogue: `shop--20261017T031500Z--nightly+prod.sql.gz`. A directory listing is the whole index.
- A dump only becomes a backup if the tool exited 0 and the stream ended with its own "dump complete" line. A dump cut short by a dropped connection is thrown away, not kept as a broken backup.
- Passwords never touch argv. URLs are asked for at the prompt and kept with your secrets, or read from an environment variable on every run.
- Supabase dumps leave out the platform schemas and keep `auth` and `storage`, so they restore anywhere.
- Retention is per tag set, and the newest backup always survives a prune.

I tested it against real Postgres 18 and MariaDB 11.8 with passwords full of `@ : /`, including a full restore of each.

## S3 buckets (0.14)

A saved connection can now be an S3-compatible bucket: AWS, Cloudflare R2, Backblaze B2, MinIO. You use it exactly like a server, in the CLI, the TUI and the desktop app.

```
diskpush connections add backups s3://site-backups --endpoint https://<account>.r2.cloudflarestorage.com --access-key-id <id>
diskpush ./site/ backups:/site/
diskpush mirror ./site/ backups:/site/
```

There is no AWS SDK in it. The S3 engine is about 1,300 lines of TypeScript over `fetch`, checked against the signatures in AWS's own documentation, and it speaks rsync's language: a trailing slash means what it means to rsync, unchanged files are skipped on size and timestamp (the timestamp survives a round trip), big files go up in multipart, and a mirror deletes only what you confirmed in the preview.

Every bucket test runs twice, against an in-memory fake and against a real `rclone serve s3`, in CI.

Both releases are on [GitHub](https://github.com/profullstack/diskpush/releases/tag/v0.14.0). Each one passed a ThreatCrush scan, with the result shown as a badge in the README.
