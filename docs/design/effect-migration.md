# Effect migration

Use the existing stable Effect 3 line across the application. Keep React and React Native as the
rendering layer; move application state, commands, asynchronous work and resource ownership into
Effect. Preserve wire formats, database contents, pairing credentials and native platform behavior.
Do not deploy intermediate migration steps to the user's installed apps or background service.

Baseline: 944 tests in 153 test files passed before this migration. Existing uncommitted desktop
lifecycle changes are part of the starting point and must be preserved.

Migration order and completion gates:

1. Shared contracts: Effect Schema, schema-derived types and boundary decoding; preserve existing
   validation, default values, URL restrictions and unknown-property behavior.
2. Shared client runtime: Effect commands/events/services and scoped transport, cancellation and
   caching; preserve mutation identities and avoid automatic mutation retries.
3. Host runtime and API: service layers, typed failures, scoped database/process/socket lifetimes,
   supervised background work and deterministic shutdown.
4. Client architecture: Effect-backed shared application state and scoped React subscriptions on
   desktop/web/mobile; preserve drafts, outbox conflict recovery, host isolation and navigation.
5. Integration: migrate all callers and tests, remove obsolete implementations/dependencies, run
   repository checks, build desktop/web/mobile and verify packaged/runtime and native flows.

Pure calculations and rendering stay ordinary TypeScript/React. Promises, callbacks and native
handles are allowed at third-party/platform boundaries; business operations compose Effects.
Resource ownership belongs to one application runtime per host/client root. No global unmanaged
fibers or duplicate authoritative state. Each migrated area must be usable and verified before
moving to its dependants.

Effect 4 was evaluated on 2026-09-23. The registry reported stable Effect 3.22.2 and Effect
4.0.0-rc.117. The Effect 4 React adapter accepts this repository's React versions, but its test
adapter requires Vitest 5 while this repository uses Vitest 4 through Vite+. The user selected
Effect 3 and a single-agent migration.

## Implemented and verified

- Application contracts and validation now use Effect Schema. Direct Zod dependencies are removed;
  third-party packages may still depend on Zod internally. Defaults, strict objects, finite/safe
  numbers, UUIDs, timestamps and URL restrictions retain their previous validation behavior.
- UI state on web, desktop and mobile uses Effect atoms, with a registry per application root. React
  only creates stable atom handles and renders their subscriptions. Native speech recognition
  retains its external-store adapter.
- Transport, host-bound reads, offline caches, workspace synchronization, startup restoration,
  collection loading and network polling have native Effect operations. Workers coalesce wakeups,
  bound collection concurrency, cancel obsolete reads and preserve explicit host ownership.
- Extension activation, commands and events, runtime startup/shutdown, task and job execution,
  child-process ownership, PR refresh workers, title/dictation generation and Live Activity delivery
  use Effect lifecycles. Shutdown drains accepted work before releasing SQLite.
- HTTP route programs compose Effects. Repository registration, branch switching, source linking and
  task creation use native Effect workflows. Non-cancellable native mutations retain their checkout
  permit until the underlying operation finishes.

The migration is not a requirement to remove every Promise or timer. React event handlers, Electron
IPC, ActivityKit/speech APIs, filesystem/SQLite adapters, provider SDKs and protocol implementations
retain their platform interfaces. Presentation clocks and socket watchdogs remain native timers
owned by their component or socket lifetime.

## Remaining scope and release gate

This is a substantial foundation migration, not yet a completed rewrite of every asynchronous
business path. Provider-specific server forge orchestration and some SDK/catalog paths outside the
Expo app still compose legacy Promise APIs. These need a further ownership/cancellation audit before
claiming the full-codebase migration complete.

The current verification includes the full automated suite, workspace typechecks, changed-file lint,
desktop/web/API builds and an iOS Hermes export. Isolated runtime checks cover startup, health,
graceful shutdown and discovery/lock cleanup. A browser check against a disposable runtime covers
draft edits reaching the server, offline retention, reconnection and reload without page errors.
Native iPhone behavior and a newly packaged installed desktop build have not been verified for this
migration. Installed production applications have not been replaced.

## Stability audit follow-up

The audit regression cases now cover interrupted cache initialization, title-worker cancellation
while HTTP drains, crash-resumable mobile registry/draft migration, and terminal reconnect
ownership. Terminal clients acquire fresh tickets with capped backoff and foreground recovery; input
is never replayed. Packaged Mac desktop provisions a private per-profile launchd agent for a fresh
workspace, while leaving an already running external runtime under its existing supervisor.

An isolated launchd runtime was verified after its provisioning process exited and after a forced
crash/restart, retaining the same owner identity and database. The temporary service was removed.
This does not replace native iPhone network-transition tests or testing a newly installed desktop
package. The installed production runtime remains unchanged.

A second stability pass added atomic task admission checks during shutdown and a worker-readiness
failure fallback. Process ownership now uses a persistent SQLite lock held until close/process exit;
concurrent stale-lock contenders and crash recovery are covered with separate OS processes. Terminal
sockets use acknowledged binary heartbeat control frames with a bounded deadline, independent of
user output. The desktop updater unloads only its verified launchd-owned process, restores it if
installation fails, and checks protocol compatibility on normal attachment. Supported provider
credentials are persisted in an owner-only JSON file and loaded by the service entrypoint.

Verification includes 991 automated tests, workspace typechecks, production builds, and an isolated
launchd test covering private credential loading, parent exit, crash recovery, update unload, and
restart with retained credentials. Physical iPhone network transitions and a signed installed-update
cycle remain unverified. Increment `RUNTIME_PROTOCOL_VERSION` for incompatible protocol changes.

## Expo completion and desktop recovery

All authored Expo application, entrypoint, terminal, configuration and config-plugin source is now
TypeScript, included in its strict typecheck. Metro, Babel, Expo plugin introspection and Hermes
export load the TypeScript files directly with the repository's Node 24 toolchain. Swift platform
files and generated bundles remain in their native formats.

Expo screen workflows compose Effect 3 operations for transport, registry changes, offline cache,
forms, attachments, message delivery, dictation, shortcuts and Live Activities. Effect atoms remain
the application state source. `mobileWorkflow` maps synchronous SDK throws into the same error
channel as rejected native operations; `nativeEffect` adapts SDK and UI callbacks. Promise-returning
React/SDK interfaces and compatibility entrypoints execute those programs through `runClientEffect`.
Native speech and WebView event adapters retain their required callback interfaces.

Draft storage holds a per-key semaphore through uncancellable native writes, including fiber
interruption. Shortcut inbox transactions share a semaphore across root remounts. Live Activity sync
and push-token registration are serialized, and controller disposal interrupts owned registrations.
The desktop update admission gate remains closed until recovery; incompatible runtime startup leaves
the window and updater accessible. Launchd receives persisted CA paths before Node starts.

This pass verifies 998 tests in 168 files, all 15 package typechecks, clean lint, production builds,
Expo config introspection, Android autolinking configuration and the final iOS Hermes export. An
isolated launchd process confirmed that the extra CA is loaded before application code, survives
parent exit, restarts after a crash and restores the same private configuration after update unload.
The temporary service was removed. Physical iPhone behavior and signed installed updates remain
unverified; this pass does not replace the installed applications.
