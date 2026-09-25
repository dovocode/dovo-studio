# Contributing

## Set up

Use Node.js 24.11 or newer and pnpm 12.3.4 (the versions are declared in the root `package.json`).
From the repository root, install the locked dependencies with:

```sh
pnpm install --frozen-lockfile
```

## Run an app

The root scripts prepare each app's workspace dependencies where needed:

```sh
pnpm dev:desktop
pnpm dev:web
pnpm dev:mobile
```

Desktop starts its own runtime. For web, also run `pnpm dev:api` in a separate terminal. Mobile
starts Expo and needs a running runtime plus a native development build; Expo Go does not include
the required native modules. Choose a simulator or connected device through Expo.

## Test and check changes

Run one test file while iterating, then the full suite when the change warrants it:

```sh
pnpm exec vp test packages/protocol/src/pending-message.test.ts
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
Package-specific checks can be run with `pnpm --filter @dovo/<package> typecheck`.

Task, recovery, and automation integration tests share the bounded budgets in
`packages/runtime/src/testing/integration.ts` because they run real Git commands. Use state
assertions through `waitForRuntime`, not arbitrary sleeps; keep pure unit tests on their normal
short deadlines. On a loaded development machine, run process-heavy suites with `--maxWorkers=1`.

Test observable behavior at the boundary: cover a user-visible change, a meaningful failure or
recovery path, and cancellation when it affects the caller. Avoid tests that only repeat an
implementation detail. Handle errors where the caller can recover, preserve useful domain errors,
and keep cancellation distinct from ordinary failure.

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

Effect 3 is used alongside existing Promise APIs. Follow the nearest integration boundary, reuse the
repository's Effect helpers for IO, cancellation, and polling, and avoid wrapping pure UI in
Effects. See [Effect patterns](docs/effect-patterns.md) for error-channel and lifecycle conventions.
