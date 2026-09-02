# hqtui.com

The HQTUI marketing site and documentation. Next.js App Router, Tailwind v4,
deployed to Railway from the `Dockerfile` at the repository root.

## Development

```bash
bun install          # from the repository root
bun run --cwd apps/web dev
```

The site imports `@profullstack/hqtui` from the workspace, so build the library
first if you have not already:

```bash
bun run build
```

## Screenshots

The terminal frames on the site are real captures of `hqtui-demo` running on
real machines, not browser-rendered mockups. Regenerate them with:

```bash
bun run --cwd apps/web shots
```

That writes intermediate HTML and pre-crop frames into `apps/web/.shots-tmp/`,
which is ignored, and finished PNGs into `public/shots/`.

## Analytics

Theme votes and page views are stored in Turso and read through a small
`fetch`-based client in `lib/db.ts`. Both are optional: with
`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` unset the site renders normally
and the counters read zero.

## Deployment

Railway builds the root `Dockerfile`, which compiles the library, builds the
site in standalone mode, and serves it with `bun apps/web/server.js`. See
`railway.json`.
