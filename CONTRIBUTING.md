# Contributing

## Set up

Use the exact Node.js version in `.node-version` and the pnpm version declared in the root
`package.json`. Check them with `node --version` and `pnpm --version`, then install the locked
dependencies from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec vp hooks enable
```

## Run an app

The root scripts prepare each app's workspace dependencies where needed:

```sh
pnpm dev:desktop
pnpm dev:web
pnpm dev:mobile
pnpm dev:site
```

The public brand website runs independently at http://localhost:3001. See
[its README](apps/site/README.md) for static deployment and browser checks.

Desktop starts its own runtime. For web, also run `pnpm dev:api` in a separate terminal. Mobile
starts Expo and needs a running runtime plus a native development build; Expo Go does not include
the required native modules. Choose a simulator or connected device through Expo.

## Test and check changes

Run one test file while iterating, then the full suite when the change warrants it:

```sh
pnpm exec vp test packages/protocol/src/conversation/workflow/pending-message.test.ts
pnpm test
```

`pnpm test` builds `@dovo/api` and its workspace dependencies before running the suite. This matters
for lifecycle or API tests that import compiled package output. For a targeted test with the same
compiled requirement, build that chain first with `pnpm --filter @dovo/api... -r build`, then run
the test file with `vp test`.

Useful repository checks are:

```sh
pnpm exec vp fmt path/to/changed-file.ts --check
pnpm check
pnpm lint
pnpm typecheck
pnpm build
```

Use `pnpm exec vp fmt <paths>` to format selected files. `pnpm check` is the repository's combined
Vite+ check; `pnpm typecheck`, `pnpm lint`, and `pnpm build` run their named workspace tasks.
Package-specific checks can be run with `pnpm --filter @dovo/<package> typecheck`. Run
`pnpm test:browser` for all registered browser suites, or an individual `test:*:browser` script for
a focused check. Before running a focused browser check, run `pnpm exec playwright install chromium`
(`--with-deps chromium` on Linux when system libraries are missing). CI runs the same registry in
four shards. The local runner chooses up to four shards based on available CPUs. Use
`pnpm test:browser --jobs 1` for serial execution or `--jobs 4` to run four shards on one machine.
Register new browser checks in `package.json`. The runner rejects unregistered `check-*-browser.mjs`
files. New browser fixtures should use `scripts/browser/harness.mjs`, which checks for unused stubs
and requires an importer for relative module replacements.

The pre-commit hook checks staged whitespace, changelog fragment headers, formatting and lint. Fix
the reported files and stage them again. To push to `main`, use a clean checkout of the commit being
pushed. The pre-push hook runs `pnpm verify:push` there. It builds and typechecks the workspace and
runs the changelog, interface copy, packaging, runtime and browser checks for recent release
regressions. You can run `pnpm verify:push` on any branch while you work. Run
`pnpm exec vp hooks status` to check the current checkout and `pnpm exec vp hooks enable` to set up
the hooks in a new worktree. On machines with eight or more available CPUs, the hook runs the
independent browser, runtime and CI script checks concurrently after workspace preparation.

For full local verification, run `pnpm verify:ci` for typechecking, unit/integration tests,
formatting/lint, builds, packaging/CI script regressions, runtime synchronization, Expo
configuration, Metro module validation and every registered browser suite (including the complete
design-system audit). Verification builds first, so generated package exports exist even in a fresh
checkout. It installs Playwright's managed Chromium before the tests and reuses the workspace build
for the browser suites. On Linux, install missing browser dependencies first with
`pnpm exec playwright install --with-deps chromium`. The runtime browser tests require Chromium
sandbox support on the host. To reproduce one CI browser shard, run
`node scripts/run-browser-suites.mjs 3 4` (zero-based shard). `pnpm test:ci:scripts` runs the same
packaging, CI, changelog and proof script tests as the Check workflow.

`verify:ci` covers the portable checks. CI additionally runs platform-specific Windows/macOS process
tests, Electron/media checks under a window manager, native mobile builds, bundled model inference
and TURN kernel/network-namespace checks; those need their respective OS, SDK or system
dependencies. A local pass does not replace these hosted checks.

Mobile integration CI pairs installed Android and iOS release builds over HTTP, opens a thread from
a link, restarts the app with the runtime unreachable, and sends the recovered draft once after
reconnect. To run that flow with Maestro on a disposable stock Android emulator and the release APK
installed, build the runtime with `pnpm --filter @dovo/runtime... -r build` and run
`node scripts/verify-mobile.mjs <emulator-id> --android-recovery`. The flow clears the app data on
that emulator. If ADB disconnects during the initial launch, the runner waits for it and starts one
fresh Maestro session. Failures after launch go straight to the diagnostics.

Task, recovery, and automation integration tests share the bounded budgets in
`packages/runtime/src/testing/integration.ts` because they run real Git commands. Use state
assertions through `waitForRuntime`, not arbitrary sleeps; keep pure unit tests on their normal
short deadlines. On a loaded development machine, run process-heavy suites with `--maxWorkers=1`.

Test observable behavior at the boundary: cover a user-visible change, a meaningful failure or
recovery path, and cancellation when it affects the caller. Avoid tests that only repeat an
implementation detail. Handle errors where the caller can recover, preserve useful domain errors,
and keep cancellation distinct from ordinary failure.

## Prove a bug fix

A regression test is only useful if it fails without the fix. Check this with:

```sh
pnpm prove -- packages/runtime/src/agents/catalogs/codex.test.ts
pnpm prove -- --base origin/main path/to/first.test.ts path/to/second.test.ts
```

The script finds the merge-base of `HEAD` and `main`, or of `HEAD` and the `--base` ref. It makes a
temporary git worktree at that commit and copies only the given files into it. Then it installs the
base dependencies and runs the tests there. The tests must fail. Last, it runs the same tests on
your checkout, including uncommitted changes. The tests must pass.

- The command exits with 0 when the proof holds and 1 when it does not. Setup errors exit with 2. If
  a test file cannot load on the base, the command exits with 3.
- `*.test.ts` and `*.test.tsx` files run with `vp test`. `*.test.mjs` files run with `node --test`.
- If a test needs a new helper or fixture, pass that file too. The script copies it, but runs only
  `*.test.*` files.
- Add `--build` for tests that import compiled package output. It builds the `@dovo/api` chain in
  the base worktree. Build your own checkout first.
- A test file that cannot load on the base proves nothing. This happens when it imports a module or
  an export that the base does not have, or has a syntax error. The script reports "Not proven: the
  test could not load on the base". Make the test import only code that the base has, such as the
  function you fix, and pass new helpers as files.
- Still read the base output. Vitest turns a missing export into `undefined`, so a call to it fails
  inside the test with a `TypeError`. The script counts that as a normal failure.

The temporary worktree goes in `~/.cache/dovo-prove`. Set `DOVO_PROVE_DIR` to use another folder.
Keep it on the same disk as the pnpm store, because pnpm then hard-links packages instead of copying
them. With a warm store, the install takes about 10 seconds. The script does not symlink your
`node_modules`, because pnpm's workspace links would then load your checkout's packages instead of
the base's. The script removes the worktree when it finishes, fails or gets Ctrl-C. It does not
change your working tree, index or stash.

## Changelog fragments

Add one file to `changelog.d/` for each pull request that users will notice. The file has a short
header with the category and the affected clients, then one to three plain lines for users. See
[changelog.d/README.md](changelog.d/README.md) for the format and the release steps.

```sh
pnpm changelog:check
pnpm changelog:preview
```

The Changelog workflow fails a pull request that changes files under `apps/` or `packages/` but adds
no fragment. A change to an existing fragment does not count. Changes to tests, test helpers,
fixtures and Markdown docs do not count. Neither do changes to `apps/site`, `apps/design-system` and
`apps/review-demo`, because they do not ship in releases. If users will not notice the change, add
the `skip-changelog` label. The check runs again when you add or remove a label.

## Change checklist

This list is the same as the one in [AGENTS.md](AGENTS.md).

- Cover every entry point: desktop and web, mobile, the command palette, and agent MCP tools when
  agents can use the feature.
- Expect older runtimes. Gate new runtime features behind a snapshot capability flag, such as
  `botsSupported` in `packages/protocol/src/runtime/connection/runtime.ts`, and show a clear
  fallback when the flag is missing.
- Make every state reversible. If a user can turn something on, they can turn it off. A one-way door
  is a bug.
- Test offline and reconnect. Keep drafts, settings and pairings. Recover without new setup.
- Keep HTTP for LAN and VPN runtime addresses, including Tailscale and NetBird. Keep pairing codes
  and device tokens required.
- Update docs in the same change.
- Add a `changelog.d/` fragment when users will notice the change.
- For a bug fix with a test, run `pnpm prove -- <test files>` to show that the test fails without
  the fix.

## Code structure

Keep a feature's components, hooks, view-specific state, and pure helpers together under its owning
app or `packages/extension-*` feature. Prefer cohesive modules such as `feature/issue-detail.tsx` or
`feature/use-selection.ts` over growing a single screen file. Keep pure transformations separate
from IO so they can be tested directly.

When a file is the established public entrypoint, preserve it as a small export barrel and put the
implementation in the feature folder. Internal callers should import the implementation module
directly when that keeps dependencies clear. Avoid import cycles and cross-package imports into
another package's private source. See [architecture and code ownership](docs/architecture.md) for
package boundaries.

Effect 4 is used alongside existing Promise APIs. Follow the nearest integration boundary, reuse the
repository's Effect helpers for IO, cancellation, and polling, and avoid wrapping pure UI in
Effects. See [Effect patterns](docs/effect-patterns.md) for error-channel and lifecycle conventions.
