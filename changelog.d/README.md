# Changelog fragments

Each pull request that users will notice adds one Markdown file to this folder. The release flow
turns these files into release notes.

## Format

Name the file after the pull request number, such as `123.md`. If you do not have a number yet, use
a short lowercase slug, such as `fix-thread-titles.md`. Numbered files get a `(#123)` link in the
notes.

```md
---
category: Fixed
clients: desktop, mobile
---

Thread titles stay the same after a reconnect.
```

- `category` is one of `Added`, `Changed`, `Fixed`, `Removed` or `Security`.
- `clients` lists one or more of `desktop`, `web`, `mobile` and `server`, separated by commas.
- Below the header, write one to three plain lines for users. Say what changed for them, not how the
  code changed. Do not use headings or list markers. The notes join the lines into one bullet.

The header is a fixed format, not YAML. Use only these two keys.

## Checks

```sh
pnpm changelog:check
pnpm changelog:preview
```

`changelog:check` validates every fragment. `changelog:preview` prints the notes that the current
fragments make.

The Changelog workflow runs the same validation on every push to `main` and every pull request. A
pull request that changes files under `apps/` or `packages/` must add a fragment. An edit to an
existing fragment does not count. Changes to tests, test helpers, fixtures and Markdown docs do not
count. Neither do changes to `apps/site`, `apps/design-system` and `apps/review-demo`, because they
do not ship in releases. If users will not notice the change, add the `skip-changelog` label. The
check runs again when you add or remove a label.

## Releases

Nightly release notes start with a "What's new" section. It lists the fragments added since the
previous published nightly. The full commit list follows.

For a stable release, update the version in the root `package.json`, then run:

```sh
pnpm changelog:release
```

This adds a section for that version to `CHANGELOG.md` and deletes the fragments it used. Commit
`CHANGELOG.md` and `changelog.d/` with the version change, then tag the release. The Release
workflow puts that section above the notes that GitHub generates. It stops a stable release if
fragments remain in this folder.
