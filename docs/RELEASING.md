# Releasing

Two packages go out together from one commit, `@profullstack/hqtui` and
`@profullstack/hqtui-demo`, at the same version.

## Cutting one

1. In one PR, bump the version everywhere it is written by hand, and
   `bun.lock` with it. `bun test packages/hqtui/test` fails if a copy is
   stale, which is what the version tests are for.
2. Squash it.
3. Write the notes as a draft release, which triggers nothing:

   ```sh
   gh release create v0.6.3 --draft --notes "..."
   ```

4. Push the tag at the merge commit. This is what starts the release:

   ```sh
   git tag v0.6.3 "$(git rev-parse origin/main)"
   git push origin v0.6.3
   ```

The workflow packs, publishes, verifies both versions on npm, and only then
turns the draft into the release. A release that never appears means the
registry work never finished. Step 3 is optional: with no draft, the workflow
creates the release from the commit log at the end instead.

The tag push is the way in because a draft cannot be one. GitHub does not
trigger workflows for the `created` activity type on draft releases, so a
saved draft sits there doing nothing until a tag arrives.

A version with a prerelease suffix publishes under the `next` dist-tag rather
than `latest`, and its release is marked as a pre-release, so
`npm install @profullstack/hqtui` keeps resolving to the last real version.

Creating a public release directly — `gh release create v0.6.3` with no
`--draft` — still works and still publishes both packages. It just announces
the version before the registry has it, which is the ordering that made
issue #93 possible.

## When a publish fails

Re-run the failed workflow run. That is the whole recovery.

The version does not need to be bumped and the release does not need to be
recreated, because nothing in the run is unconditional:

- both tarballs are packed before either is uploaded, so a build failure
  happens while nothing is public;
- each package is compared against what the registry already has. A version
  that is present and matches what this run packed is skipped; a version that
  is absent is uploaded;
- a version that is present with *different contents*, or a registry that
  cannot be read, stops the run before anything is uploaded. Those are the two
  cases that need a person.

This is what [issue #93](https://github.com/profullstack/hqtui/issues/93)
asked for. Run 33854645746 published the library, failed on the demo, and left
a public v0.1.10 release for a version nobody could install in full; retrying
it hit the library again, which npm refuses, so 0.1.10 was abandoned for
0.1.11. The same failure today is a re-run.

The packed tarballs are kept as a run artifact (`release-<tag>`), so the exact
bytes a failed run produced can be inspected or resumed from by hand:

```sh
node scripts/publish.mjs publish --from ./release
```

## Doing it by hand

```sh
bun install --frozen-lockfile
bun run typecheck && bun test packages/hqtui/test && bun run build
node scripts/publish.mjs pack --out .release-artifacts --event release --ref v0.6.3
node scripts/publish.mjs publish --from .release-artifacts --dry-run
```

The dist-tag comes from the version unless `--tag` names one, so there is
nothing to remember for a prerelease.

`pack` refuses to package a tarball that is missing its build: it checks every
path `package.json` promises, and follows the relative imports inside the
tarball. `apps/demo`'s entry point is one line — `import "../dist/main.js"` —
so that second check is the one that catches a demo packed without a `dist`.

Publishing a tarball does not run `prepublishOnly`, by design. The build runs
once, before anything is uploaded, rather than on the way out the door.

The workflow needs `NPM_TOKEN`, and `contents: write` to turn the draft into a
release.
