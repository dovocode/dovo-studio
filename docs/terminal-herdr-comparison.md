# Terminal parity with Herdr

The goal is to run the same terminal workflow through Dovo's own CLI. Dovo owns the shell, its
screen and its local control channel. The comparison below records the starting point at `f32f28b4`
and the behavior used to test the replacement.

## Linux baseline

| Operation                                         | Dovo Studio                                                                                                                                                     | Herdr Core 0.1.21                                                                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start a shell and record its identity             | An authenticated local HTTP request created a remembered terminal in a temporary project. Its shell printed its PID and set a shell-local variable.             | `hc run --bg --name review` started a shell that printed its PID and waited on input. `hc get review --json` returned its address, PID, and state.                                                     |
| Restart the service                               | Closing and restarting the runtime on the same SQLite database restored the terminal ID. The shell PID changed. The variable and prior output marker were gone. | After `hc server restart`, the address and shell PID were unchanged. `hc send review continue` completed the original read. `hc read` contained both markers with the same PID.                        |
| Lose the underlying process or reboot the machine | A remembered shell reopens in its directory. Supported agents can resume their exact conversation.                                                              | Core's documented `--keep` recovery starts a fresh shell after a lost process. The full Herdr client also supports restoring layouts and resuming supported agents. Reboot behavior was not exercised. |

The smoke test used the upstream Linux x86-64 release, matched its SHA-256 against the release
manifest, and used a private Core session, socket, config and state directory. Core was stopped
after the test. The Dovo test used a local PTY and a file-backed runtime. These checks did not
measure frame rate, startup latency or throughput.
[Core release manifest](https://releases.herdr.dev/core/0.1.21/manifest.json) ·
[Core recovery](https://github.com/herdrdev/herdr-core/tree/v0.1.21#run-it-and-come-back) ·
[Herdr 0.9.5](https://github.com/herdrdev/herdr/tree/v0.9.5)

## Dovo restart check

On Linux, the built Dovo CLI runtime created a remembered terminal in an isolated home directory.
Its foreground Node program recorded its PID, then waited on standard input. The test stopped and
restarted the runtime once with SIGTERM and once with SIGKILL. It retried the original launch ID
after each restart. The original program received the new input over a terminal WebSocket and
recorded the same PID. It ran once. Explicit Close ended the process. A separate case stopped the
runtime with SIGKILL as soon as it accepted a launch. Retrying the request ran the command once,
both for a new terminal and for a split.

The full-screen fixture emitted enough output to exceed the raw replay limit. After each restart,
the screen read returned the same alternate buffer, cursor and 82-column by 18-row grid. A second
viewer could watch at a different size. Typing transferred control of the grid to that viewer. The
same Linux fixture completed one root turn, marked it read and reported a child waiting for
permission before filling the replay buffer. After graceful and abrupt restarts, the snapshot
retained turn 1, read turn 1 and the blocked child. It rejected a write with the old read revision.
Run `pnpm test:terminal-restart` to repeat this check.

The same test passed with the runtime in a transient systemd user service. Stopping that unit
terminated its control group. Dovo's separate holder service kept the foreground program running.
Neither test required Herdr. Run the process restart check in a source checkout with
`pnpm test:terminal-restart`. These runs exercised Linux x86-64. The launchd adapter has unit tests.

The Linux CLI check started a named terminal in a directory outside the project list. It waited for
a blocked report, read the screen and attached to the terminal after a runtime restart. The CLI
displayed an alternate-screen header after more than 1 MiB of output evicted its original bytes.
Ctrl+] detached the viewer. The same program then accepted input and exited with code 7. The event
stream reported the exit and the explicit close. See the
[terminal CLI commands](unified-workspace.md#terminal-cli).

## Terminal and agent states

On Linux, a fixture program emitted OSC 7501 reports inside Herdr Core 0.1.21. Each row below
records what `hc get fixture --json` returned. The child was a named status record within the same
terminal.

| Fixture action            | Terminal | Root activity     | Child activity      | Turn |
| ------------------------- | -------- | ----------------- | ------------------- | ---- |
| Report working            | live     | working           | none                | 0    |
| Child requests permission | live     | working           | blocked, permission | 0    |
| Root asks a question      | live     | blocked, question | blocked, permission | 1    |
| Root goes idle            | live     | idle              | blocked, permission | 1    |
| Root resumes work         | live     | working           | blocked, permission | 1    |
| Root reports done         | live     | done              | blocked, permission | 2    |
| Program exits with code 7 | finished | none              | none                | 2    |

Core advances the turn when the root leaves `working`. A turn can end because the agent needs
permission, finishes, clears its report or exits. A child report affects its own record. Core can
distinguish the turn after a send from a completion already on screen.
[Core status transitions](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/status.rs)
· [Core waits](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/wait.rs)

Herdr App uses `herdr.seen` to record the last turn a person viewed. Blocked and error states still
need attention after viewing. For an idle or done agent, a newer turn shows as Done until someone
views it. The app's rule requires a visible agent in a foreground window. The label specification
defines how to mark a turn unread. This review did not find a desktop command that performs it.
[Herdr App label rules](https://github.com/herdrdev/herdr-app/blob/v0.1.16/docs/labels.md)

Dovo separates shell exit, root activity, child activity and human read state. CLI and MCP callers
can wait for a turn after a known one. Studio shows a blocked child while preserving the parent's
own badge. Ordinary threads stay in the thread list.
[Dovo terminal status](../packages/protocol/src/runtime/connection/terminal-status.ts) ·
[Metadata parser](../packages/runtime/src/terminal/metadata.ts) ·
[Activity wait](../packages/runtime/src/terminal/activity-wait.ts)

Count turns where the report arrives. The provider hooks replace one activity file and the runtime
checks it every 500 ms. Two transitions between checks could look like one. A restored holder must
also preserve the counter when it replays the screen. Desktop and mobile already mark a thread
viewed when a person sees its current turn. Apply the same visibility rule to terminals, including
the guard that keeps a late acknowledgement from marking a newer turn read.
[Hook writer](../packages/runtime/src/terminal/recovery-integrations.ts) ·
[Thread view state](../packages/runtime/src/storage/workspace.ts)

### What a send waits for

In a second Core run, the fixture had already finished turn 1. A plain `hc wait` returned `done`,
turn 1. After `hc send review next --wait`, the fixture paused for 220 ms, reported `working` and
immediately reported `done`. The send result recorded turn 1 at delivery. Its wait returned turn 2.
When the fixture accepted another line and emitted no new activity, the result was `started: false`
and `reason: not_started`. The old Done did not finish the new request.
[Core send](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/api.rs#L497-L510)
·
[Core wait](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/api/waiting.rs#L14-L39)

### What a parent waits for

Another fixture launched two child terminals from inside a parent terminal. An unrelated shell ran
alongside them. One child asked for permission while the second kept working. A wait from inside the
parent produced these results:

| Operation                                             | Observed result                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `wait --children any`                                 | Returned the child asking for permission. The parent still reported Working, turn 0. |
| `wait --children all` with a short timeout            | Timed out. The result listed one blocked child and one working child.                |
| `wait --children all` after the second child finished | Returned both children, one blocked and one done. Both were still live.              |
| `send` to the blocked child                           | Refused with exit code 9.                                                            |

The unrelated shell never appeared in these results. Core stores a parent address when a terminal
launches a child. That relationship has different semantics from a named OSC record within one PTY.
An all-children wait answers whether any child is still working. Check each returned state before
treating the work as successful. The parent's record of child news is separate from the turn a
person last viewed.
[Child waits](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/api/waiting.rs#L193-L291)
· [Parent notes](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/notes.rs)

With no wait active, an idle parent in the fixture received this line on standard input:

```text
<hc>t2 reviewer is blocked (permission). See: hc read t2</hc>
```

The parent stayed idle. The child's free-text message stayed in its own record. In Core's code, a
matching parent wait suppresses a second note. A recent human draft delays delivery. The parent's
receipt of this message and a person's viewing of the child are separate acknowledgements.
[Note delivery](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/notes.rs#L126-L176)
·
[Input arbitration](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/input.rs#L266-L276)

### How the desktop app decides who needs attention

The app lists all terminal panes. Its agent list requires a reported status. A recognized foreground
executable can supply a program icon and name. In the expanded Priority view, a blocked child can
move its parent's group to Needs you while the parent keeps its own Idle badge. The child shows the
warning. Pinned groups keep their place. A child's alert goes to its parent. The desktop app
suppresses a separate alert for that child. Looking at the child in a foreground peek can advance
the human's seen turn. A blocked child still needs a decision after being seen.
[Agent list](https://github.com/herdrdev/herdr-app/blob/v0.1.16/src/window.rs#L1850-L1869) ·
[Priority groups](https://github.com/herdrdev/herdr-app/blob/v0.1.16/defaults/mods/agents/main.js#L224-L276)
· [Alert rules](https://github.com/herdrdev/herdr-app/blob/v0.1.16/src/model.rs#L550-L605)

### How the TUI detects an agent without a status report

Herdr TUI 0.9.5 has a separate detector. It identifies the foreground job, then applies rules for
that provider. Its shipped POSIX Codex and Claude hooks supply session identity. Its OpenCode plugin
also reports lifecycle and input requests. For Codex, the detector can recognize a trust prompt from
its heading and active choices. Opening a transcript viewer suppresses the screen update so an old
permission prompt in history does not become a new block. A full lifecycle hook for the current
agent takes precedence over a screen match. The detector rejects stale updates and waits for
repeated evidence before changing inferred Working to Idle.
[Process identification](https://github.com/herdrdev/herdr/blob/v0.9.5/src/pane.rs#L868-L905) ·
[Codex screen rules](https://github.com/herdrdev/herdr/blob/v0.9.5/src/detect/manifests/codex.toml#L7-L106)
·
[OpenCode integration](https://github.com/herdrdev/herdr/blob/v0.9.5/src/integration/assets/opencode/herdr-agent-state.js#L146-L210)
·
[Signal precedence](https://github.com/herdrdev/herdr/blob/v0.9.5/src/terminal/state.rs#L2032-L2098)

For Dovo, use the provider hooks and root reports already available. Keep explicit child IDs, raw
activity and the reason a row needs attention. The UI can show an idle parent with a child that
needs permission. The CLI can return that child's identity and block reason. Introduce a
provider-specific screen rule only for a confirmed signal the provider cannot report.

## Dovo terminal activity

The Dovo CLI exposes the root turn counter and explicit OSC child records in JSON output. Use
`send --wait` to take a cursor at input delivery, then wait for a later completed turn. Opening a
terminal in the foreground shares its read state across paired clients. The CLI can observe that
terminal without marking it read. A child status report describes work inside one PTY.

Dovo also launches separate PTYs with an explicit parent. The CLI can wait for any or all direct
children. A parent receives structured notices through its event stream. A parent program can read
this stream while its PTY remains available for user input. Herdr can write an unsolicited line to
the foreground program's stdin. Dovo delivers its notice out of band.

On a remembered Unix terminal, the holder observes root OSC reports and provider hooks while the
runtime is offline. Reporters can send a shared `turnId`. Two distinct IDs count separately even
when their working periods overlap. Repeating a recently completed ID keeps the same count.
Reattachment uses the holder's combined count.

For reports without IDs, the holder still matches concurrent working periods by their observed state
changes. Two independent untagged jobs that finish in the same observation can share a turn. A
holder started before turn ID support keeps its earlier behavior for its existing sessions.

## Connecting stock Herdr clients

Dovo's CLI workflow uses Dovo's own runtime API. Running stock Herdr App against Dovo would add a
separate compatibility requirement. The app first checks a configured executable. For automatic
discovery it looks for `herdr-core` or `hc` and checks that `--version` prints an `hc ` prefix.
`HERDR_CORE_DIRS` replaces the automatic search paths. The app starts the executable with `connect`,
requests framed mode over standard input and checks API generation 1, a minimum version of 0.1.11
and nine method names. Stock `hc` also expects a local Core socket for CLI commands.
[Binary discovery](https://github.com/herdrdev/herdr-app/blob/v0.1.16/src/core_bin.rs#L77-L100) ·
[App handshake](https://github.com/herdrdev/herdr-app/blob/v0.1.16/src/hc.rs#L206-L264) ·
[Core socket selection](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/paths.rs#L16-L45)

The nine methods cover the startup check. The app also calls `terminal.get` before adopting an
existing terminal and `terminal.read` when explaining a failed launch. It calls `machine.list` for
machine discovery and `server.status` for server information. Passing the handshake alone would
leave some workflows untested.
[Adoption](https://github.com/herdrdev/herdr-app/blob/v0.1.16/src/window.rs#L2278-L2294) ·
[Launch errors](https://github.com/herdrdev/herdr-app/blob/v0.1.16/src/window.rs#L2447-L2461) ·
[Machine discovery](https://github.com/herdrdev/herdr-app/blob/v0.1.16/src/window.rs#L742)

An isolated Linux `hc connect` test sent the app's hello to stock Core 0.1.21. Core advertised 32
methods. On the framed connection, a document started at version 0. Writing it produced version 1. A
second write based on version 0 returned `conflict`. Deleting it at version 1 produced a null value
at version 2. This lets two clients detect stale layout edits even after a deletion. The test
exercised upstream Core. Stock Herdr App interoperability with Dovo remains unverified.
[Wire and document contract](https://github.com/herdrdev/herdr-core/blob/v0.1.21/schema/README.md) ·
[Published API](https://github.com/herdrdev/herdr-core/blob/v0.1.21/schema/hc.openrpc.json)

## Starting point

| User task                                      | Dovo at the baseline                                                                                                                                                                                                                                                                             | Next useful change                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Leave a running terminal and return            | The runtime owns the PTY across client disconnect. Unix integration already recognizes named `hc attach` and tmux sessions. Dovo also captures exact Codex, Claude, Pi and OpenCode recovery targets.                                                                                            | Preserve a plain shell's live process across a **runtime** restart. Keep explicit Close able to end the program.                   |
| Reopen a full-screen program on another device | Desktop and web use Ghostty WASM. Mobile has a native Ghostty path and a WebView fallback. The runtime replays up to 1 Mi UTF-16 code units. The browser has a separate 16 MiB history budget. Initial mode or cursor-control sequences can fall outside the runtime buffer.                     | Restore the current screen, modes, cursor and dimensions before handing off live output. Keep scrollback bounded.                  |
| Watch from a phone while typing on desktop     | Both clients can attach. A resize from either client changes the PTY dimensions. Herdr distinguishes an active viewer and observers.                                                                                                                                                             | Give the active writer control of size. Let a second client watch without resizing or sending input. Make taking control explicit. |
| Wait for an agent in a terminal                | Dovo recognizes root OSC 7501 reports and several provider hooks. Agent tools can launch, read, write and wait for exit within their task scope. `terminal_read` with `until` waits up to 20 seconds for a reported blocked, done, idle or error state, and returns at once if it already holds. | Wait for a counted turn, as Herdr does, so a done state from an earlier turn cannot end a wait for the next one.                   |
| Organize multiple pieces of work               | Dovo already has split panes, tabs, per-computer terminal identity and a Unified sidebar. Herdr App also groups spaces and tabs and lets users peek at a worker.                                                                                                                                 | After recovery works, test restoring the intended set of sessions on another client. Keep device-specific sizes and focus local.   |

[Dovo engine and streaming](../packages/terminal/README.md) ·
[Dovo recovery and activity](unified-workspace.md) ·
[Herdr viewer arbitration](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/viewers.rs)
· [Herdr desktop](https://github.com/herdrdev/herdr-app/tree/v0.1.16)

## What to copy from upstream

Herdr Core's holder owns the PTYs and reads output while Core restarts. A versioned handshake lets
the new Core take ownership. Core maintains a parsed screen for each terminal. It pauses a new
viewer while it sends scrollback, screen modes, cursor, status reports and any unfinished escape
sequence. Test reconnect in the middle of an escape sequence as well as after buffer rollover.
[Holder](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/holder.rs) ·
[Viewer repaint](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/viewers.rs)

The most recently active typing viewer sets the grid. Typing, focusing or resizing can make a viewer
active. Observers cannot change the grid. When the active viewer leaves, Core chooses among the
remaining typing viewers or uses its headless size. Test a phone observing a desktop session, then
taking control and leaving.
[Viewer selection](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/viewers.rs)

Core tracks root and child status reports and increments a turn counter when work ends. Herdr App
records the last seen turn so that completion stays visible across devices until someone views the
terminal. For named Core sessions, test subscribing to `hc events` for blocked and finished turns.
Herdr App also stores its split trees in a versioned document on Core. Each screen keeps its own
focus and zoom. If Dovo adds shared layout editing, test concurrent edits and version conflicts.
[Status processing](https://github.com/herdrdev/herdr-core/blob/v0.1.21/crates/herdr-core/src/status.rs)
· [App labels](https://github.com/herdrdev/herdr-app/blob/v0.1.16/docs/labels.md) ·
[App layout](https://github.com/herdrdev/herdr-app/blob/v0.1.16/src/mirror.rs)

## Acceptance checks

1. **Test a separate PTY owner on Linux.** Run a remembered standalone terminal behind the
   authenticated runtime. Reconnect the Dovo terminal ID to its live PTY. The runtime remains
   responsible for device authorization, checkout access, and launch receipts. A retried launch must
   resolve to the same terminal. Exercise restart, input, resize, exit, cleanup and packaging.
2. **Test reconnect and multiple viewers.** Run a full-screen fixture, generate more output than the
   replay buffer, disconnect, and reconnect. Compare its cells, cursor and active screen against a
   continuously attached viewer. Attach clients at two sizes. Opening or rotating the observing
   phone must leave the writer's grid alone. Preserve the current stream for older runtimes and
   clients.
3. **Expose the recovered state in Studio and agent tools.** Distinguish a live reattach, a fresh
   shell and a resumed agent conversation in the UI. Exercise the same terminal via desktop, web,
   mobile and task-scoped MCP. Test a reported blocked state, a timeout, an exit, and an
   unauthorized cross-thread read or input. Then decide whether shared layouts or additional agent
   status events justify further work.

The restart test starts a command waiting on input before a runtime update. After the update it must
finish in the **same PID**, print its completion marker once, and remain closable. Repeat with a
lost launch acknowledgement. Separately test holder loss and reboot. Those cases must report
recovery accurately and must never replay arbitrary commands.

## Product and distribution constraints

Keep the session owner local to the machine. Continue to use paired HTTP or HTTPS for Dovo clients,
including LAN and VPN. Include an optional snapshot capability for new behavior. Verify native PTY
lifetime and cleanup separately on Linux, macOS and Windows ConPTY, including service stop versus
upgrade. Keep sandboxed thread terminals in their existing execution boundary. A stable user-local
integration path also matters when two runtimes on one machine register agent hooks. Verification
fixtures should use private agent config directories.

Herdr Core and its two clients use Apache-2.0. The Dovo runtime uses its own terminal service.
Existing named `hc attach` integration remains available to people who use both products.
[Core license](https://github.com/herdrdev/herdr-core/blob/v0.1.21/LICENSE) ·
[Desktop notices](https://github.com/herdrdev/herdr-app/tree/v0.1.16/THIRD-PARTY-NOTICES) ·
[Herdr license](https://github.com/herdrdev/herdr/blob/v0.9.5/LICENSE)
