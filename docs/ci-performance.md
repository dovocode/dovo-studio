# CI performance

Check retains the full Linux tests, native browser checks, macOS runtime checks and design audit.
Desktop publication still requires Check and signed, notarized, verified release artifacts from the
same commit. Mobile integration and manual mobile releases remain separate.

## Build reuse

`node scripts/ci/workspace-task.mjs build` caches a complete workspace build; use `typecheck` for
the complete workspace typecheck. Both use explicit source globs in `vite.config.ts`; native
compiler children cannot be traced reliably on every Linux host. The ordinary `pnpm build` and
`pnpm typecheck` commands remain available for uncached verification. Update the input/output lists
when introducing a generated output or a build input outside the existing source trees. Build
environment variables are fingerprinted too. The wrapper removes invocation IDs and browser-check
settings before starting Vite, so these do not leak back into nested build fingerprints.

Browser shards prepare the build once and then run every registered suite's checks without repeating
its package-build prefixes. Generators and checks remain in each suite. Task cache archives have
separate writer keys for matrix shards and can reuse compatible entries from other Linux jobs.
Source fingerprints, rather than a GitHub cache hit alone, decide whether a task can be reused.

## Browser scheduling

The browser registry is assigned longest-first using `scripts/ci/browser-durations.json`. Newly
registered suites use the median measured duration and are included automatically. Each shard emits
an actual duration summary and a `browser-timings-N` artifact, including partial results on failure.
Refresh the estimates after meaningful changes to suite timings:

```sh
gh run download RUN_ID --pattern 'browser-timings-*' --dir /tmp/dovo-browser-timings
node scripts/ci/update-browser-durations.mjs /tmp/dovo-browser-timings/*/*.json
node scripts/run-browser-suites.mjs 0 4 --list
```

The design-system matrix has four shards covering every story and hosted page in both themes and
viewports, including accessibility checks. The browser registry runs catalog interactions once. See
[design-system.md](design-system.md) for the local selection commands.

## Native packaging and system dependencies

Native dictation bundles are cached separately using the pinned upstream source, helper source,
build recipe, target architecture, compiler and SDK. A restored binary's fingerprint, hash and
license notices are checked before reuse. Signing, notarization and signature verification always
run for a release. Packaging stage durations, including separate Mac signing and notarization, are
written to the job summary.

Linux CI bounds apt download retries and timeouts. Chromium setup has a four-minute attempt budget;
if setup fails or stalls on Ubuntu's Azure mirror, it switches only that mirror to Ubuntu's primary
archive and makes one final bounded attempt. The dependency installer runs in a root-owned systemd
service with a four-minute runtime limit and a ten-second shutdown budget. Control-group cleanup
stops detached apt/dpkg descendants and waits for them before repairing dpkg; a process-group
timeout alone can leave the database locked. Fallback updates both conventional source files and
hosted Ubuntu's mirror-list files. Browser downloads run as the runner user, preserving cache
ownership. Package signatures and Chromium's sandbox stay enabled.

The baseline Check run
[40553363177](https://github.com/dovocode/dovo-studio/actions/runs/40553363177) spent 19 minutes in
the design audit and up to 11 minutes 45 seconds installing Chromium's system dependencies. The
paired [Mac release](https://github.com/dovocode/dovo-studio/actions/runs/40553372342) took 18
minutes, with 9 minutes 12 seconds inside the previously combined signing/notarization phase.
Compare fresh CI timings against these measurements; warm-cache gains require a successful first
cache save.
