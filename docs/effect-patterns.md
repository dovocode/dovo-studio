# Effect patterns in Dovo

The codebase uses Effect 3 at runtime and client boundaries, alongside existing Promise-based APIs.
Follow local conventions and migrate a boundary when you touch it; the repository is not uniformly
Effect-native yet. These helpers live in [runtime errors](../packages/runtime/src/errors.ts) and
[client runtime](../packages/client-runtime/src). See
[architecture and code ownership](architecture.md) for package boundaries.

## Turn outside IO into typed failures

Use `runtimeOperation` around a callback that calls synchronous or Promise-based filesystem,
database, process, native, or third-party SDK APIs:

```ts
const detail = yield * runtimeOperation(() => pulls.detail(cwd, number))
```

It catches synchronous throws and Promise rejections, preserving `HttpError`, `ValidationError`, and
`RuntimeOperationError`; other failures become `RuntimeOperationError`. This makes an expected
operation failure part of the typed error channel. Do not wrap an Effect value in
`runtimeOperation`; yield the Effect directly.

Runtime endpoint programs commonly use `runtimeProgram`:

```ts
return runtimeProgram(
  Effect.gen(function* () {
    const input = decode(inputSchema, value)
    if (!allowed(input)) throw new HttpError(409, 'Operation is no longer available')
    return yield* runtimeOperation(() => service.update(input))
  }),
)
```

`decode` and domain checks in existing code can throw known `ValidationError` or `HttpError` values.
`runtimeProgram` converts those known defects into typed failures so the HTTP boundary can map them
to client errors. Unknown defects remain defects; do not use this helper to disguise programming
errors or broadly turn every defect into an ordinary failure. Prefer `Effect.fail(error)` when
already inside an Effect and the failure is known.

At a Promise boundary, use `runClientEffect(effect, signal?)` from `@dovo/client-runtime`. It runs
the Effect and throws its typed failure as a rejected Promise, which current HTTP and UI callers
handle using their existing error paths. At the HTTP boundary, `createRuntimeServer` maps
`HttpError` and `ValidationError` to status codes and keeps unexpected failures as server errors.

## Cancellation and mutation completion

`runClientEffect` accepts an optional `AbortSignal`. In UI code, use `clientTaskScope()` when a view
owns multiple long-lived Effect fibers: `run(work)` tracks them, and `stop()` closes the scope and
interrupts its pending fibers. For periodic work, use `startPolling(effect, { interval, onError })`;
it coalesces wakeups, owns one worker, and its `stop()` interrupts that worker. Do not create an
untracked `setInterval` around async work.

`runtimeOperation` does not cancel the underlying Promise when its caller is interrupted. For a
cancellable transport, forward the signal from `Effect.tryPromise` to the native API and map its
failure with `runtimeFailure`. For an uncancellable write, retain its lock/permit until the write
settles; abandoning the waiting caller must not admit a conflicting write. The native draft storage
adapter follows this rule. An interrupted issue-cache read suppresses its late cache write, while
the legacy provider request itself may still finish.

Treat interruption separately from a business failure. It is not a `RuntimeFailure`. Use finalizers
for resources that must be released on success, failure, or interruption: `Effect.scoped` with
`Effect.acquireRelease`/`Effect.addFinalizer` for scoped resources, or `Effect.ensuring` for a
specific cleanup action. The polling helper demonstrates a scoped queue and worker. Keep finalizers
small, deterministic, and safe to run once.

For a mutation that must finish once accepted, protect only the state transition or commit section
with `Effect.uninterruptible`; do not make an entire network call uninterruptible without a clear
reason. `PullCache` owns shared refresh fibers independently of individual callers and drains them
before disposing its managed runtime. That is a cache ownership rule, not a general pattern for
ordinary requests.

Never add automatic retries around a mutation unless its idempotency is explicit. A retry can repeat
Git/provider writes or task creation after the first request succeeded but its response was lost.
For retryable submission workflows, use an explicit request/idempotency ID and persist its result;
for reads, use an existing refresh or bounded backoff policy where the owning service provides one.

## Error-channel checklist

- Use `Effect.fail` for an expected typed failure; use `runtimeOperation` at Promise/sync IO edges.
- Preserve domain errors such as `HttpError` and validation failures so callers can respond
  appropriately.
- Catch errors only where the caller has a recovery behavior. `catchAll` does not catch defects; use
  `catchAllCause` only when defect/interruption handling is intentional.
- Keep interruption observable for caller-owned work. Do not convert cancellation into “success” to
  silence logs; filter interruption-only causes only at an owner boundary, as `clientTaskScope` and
  `startPolling` do.
- Add tests for externally visible failure, cancellation, or recovery behavior, not for a helper's
  implementation details.
