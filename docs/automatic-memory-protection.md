# Automatic memory protection

The runtime enables automatic memory protection by default. No setup is required. It samples
dedicated agent process trees on Linux and macOS. This is a watchdog, not a hard memory limit. A
fast allocation can still cause an OS out-of-memory failure before it reacts.

The runtime samples every five seconds while an agent run or its owned native children are active.
It reads process IDs, parent IDs, process groups, start identities and resident memory (RSS). It
does not read process arguments or environment values for diagnostics. RSS can count shared pages
more than once. The watchdog counts each owned PID once across registered trees. Run selection also
counts each PID and start identity once within each run, even when its registered trees overlap. The
minimum stop size applies to the whole run.

The policy uses these machine limits:

- Owned-agent RSS budget: `max(total memory - 6 GiB, 50% of total memory)`.
- Available-memory headroom: `min(4 GiB, 20% of total memory)`.
- Linux uses `MemAvailable`. Readable cgroup v2 limits on the runtime and its ancestors reduce the
  machine budget and available memory when needed. For each finite limit, it reads `memory.current`
  and `memory.stat` (`inactive_file`). Cgroup available memory is
  `min(limit, max(0, limit - current + inactive_file))`. This includes reclaimable inactive file
  cache. The lowest available-memory reading across the host and these cgroups applies. Missing or
  invalid required usage or cache readings make protection unavailable for that sample.
- macOS requires a kernel memory pressure warning or critical state. It also queries
  `memory_pressure -Q` for the reclaimable free-memory percentage. Low `os.freemem()` alone cannot
  cause an active stop.

When available memory falls below the headroom, the runtime first releases idle provider processes.
Providers with working native children are not idle. After cleanup, fresh readings must show both
machine pressure and owned-agent RSS above the budget for at least ten seconds. The runtime then
selects the largest eligible owned run. It rechecks process identity, current run ownership,
available memory and RSS before it stops the run.

The stop uses normal task cancellation. It pauses queued work, saves an explicit memory-stop reason
and stops the run's dedicated process groups. It also cancels the run's Dovo children. It preserves
saved transcripts, partial answers, queued input, drafts, worktree files, pairings and credentials.
It does not undo changes. Free memory, then explicitly start or resume the thread. Runtime restart
does not automatically resume the stopped work.

Only one automatic stop can occur during a machine-pressure episode. The runtime waits for machine
pressure to clear before it can stop another run. A sampling failure, unavailable pressure source or
unconfirmed process cleanup prevents further action. It reports the failure in runtime diagnostics.
No sampled process ID alone authorizes a signal.

## Coverage and limits

| Runtime or provider                             | Coverage                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Linux runtime                                   | Sampled process-tree protection; no new systemd or cgroup hard limit                |
| macOS runtime, including Mac Studio             | Sampled process-tree protection; no hard limit                                      |
| Windows runtime                                 | Automatic enforcement unavailable                                                   |
| Windows, macOS, Linux and mobile clients        | Use the connected runtime's protection status                                       |
| Codex, Claude, ACP, Hermes, Pi, Vibe, Cursor    | Dedicated launchers; warm launchers rebind to each run                              |
| ACP client terminals and agent hooks            | Dedicated processes registered to the owning run                                    |
| OpenCode local shared server or external server | Excluded; a thread cannot stop a server used by another thread                      |
| Native Copilot SDK and Muse SDK                 | Unavailable; their public APIs do not expose a safe dedicated `ChildProcess` handle |
| In-process and externally managed providers     | Unavailable unless a dedicated launcher is registered                               |

Provider-native children inherit their launcher's process group in normal operation. The watchdog
also observes descendants that create a separate group. Process-group cleanup cannot guarantee
termination of descendants that escape with `setsid` or `setpgid`. It does not signal those sampled
PIDs. If tracked descendants survive a stop, diagnostics report unconfirmed cleanup and hold further
automatic stops until pressure clears. Descendants that detach and reparent between samples can
escape observation. This is not kernel containment.

Other runtime work, manual terminals, browser processes and secure-input commands do not gain
per-agent ownership from this feature. Runtime heap growth never identifies an active thread as the
cause of machine pressure.

Runtime diagnostics include `memory.protection`. It reports the mode, budget, headroom, readings,
covered and uncovered run counts, per-run coverage and the last stop. The host can request
diagnostics with the existing authenticated `POST /api/runtime/diagnostics` operation. Older clients
can ignore these optional fields.

## Verification

Run these commands from the repository root:

```sh
pnpm --filter @dovo/runtime... -r build
pnpm --filter @dovo/runtime typecheck
pnpm exec vp test packages/runtime/src/agents/execution/memory-protection packages/runtime/src/agents/execution/process-memory packages/runtime/src/agents/tasks/memory-protection.test.ts --maxWorkers=2
```

The focused tests inject memory pressure. They cover idle cleanup, small-host budgets, unsupported
platforms, shared-provider exclusion, warm reuse, process identity changes, run changes, unavailable
readings, cleanup failures and disposal. A bounded real process tree checks shutdown without
exhausting memory. A SQLite integration test checks the saved reason, partial transcript, paused
queue, runtime restart and explicit recovery.

The current sampler passed a real Linux cgroup v2 check in a disposable systemd user service with
`MemoryMax=256M`. It reported the actual limit of 268435456 bytes, available memory of 253362176
bytes and its own process identity. This check generated no memory pressure. Cache arithmetic and
ancestor-limit combinations have mocked tests. Docker verification was unavailable because of Docker
access permissions.

Bounded smoke tests with the current guard passed on Linux and a physical Mac Studio. They used the
real OS sampler and stopped a small owned child while preserving an unrelated child. These tests
simulated pressure; they did not exhaust RAM or prove that the default thresholds can prevent an OS
OOM failure. macOS command parsing and policy also have mocked tests. Windows enforcement is
unavailable by design. No destructive OOM or actual RAM-exhaustion test was run.
