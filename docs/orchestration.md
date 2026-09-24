# Turn ownership and recovery

The runtime owns submission admission, queue order, provider callbacks and finalization. Desktop and
iPhone render persisted state; a disconnected client does not decide whether a turn finished.

## Accepted input

A task/message ID identifies one submitted input. The runtime commits a private SHA-256 receipt of
its text and attachment metadata in the same SQLite transaction as the queued message. The receipt
survives removing the queued message and restarting the runtime. Retrying the same input
acknowledges its original acceptance; changed contents with the same ID are rejected. Receipts are
removed with their task. This guarantees idempotent admission, not exactly-once external agent
actions. Resume after an interrupted agent run still requires reviewing existing work.

Removing a message from the queue also commits its preparing attempt. Recovery before that
transaction dequeues the request normally; recovery afterward resumes the admitted input before
later queued messages. Session allocation does not consume input. Adapters report acceptance from
prompt acknowledgements or actual turn output, and the runtime persists consumed message IDs at that
boundary. A crash between remote acceptance and local persistence remains ambiguous: continuation
includes unconfirmed input with instructions to inspect existing work, not an exactly-once
guarantee.

## Provider work and change capture

Tasks progress through preparing, provider work and finalizing while retaining the checkout lock.
The provider's outcome and finish time are persisted before capturing changes. Desktop and iPhone
show **Saving changes** during that capture, and follow-up messages wait for it to finish. A slow
Git snapshot does not extend the reported agent duration. A restart during finalization retains the
provider outcome, marks the incomplete checkpoint and holds the remaining queue; it does not replay
the finished provider turn. Capture failures retain the terminal outcome and expose **Retry saving
changes** on desktop and iPhone. Retrying runs only snapshot/diff capture before any queued input.
Automatic restart recovery still follows the existing opt-in runtime preference. Codex and ACP
launchers are owned process groups on Unix; cleanup awaits exit, escalates after one second and
reports failure after two seconds instead of treating an unconfirmed shutdown as a safe checkpoint.

Once a provider run settles, its callbacks cannot add output, change session identity, update
activity, create subagents or open new approval/question requests. Outstanding synchronous
interactions are dismissed. Message forms already presented can still be answered after a turn ends.
A stable answer message ID, private answer hash and queued input commit together before
acknowledgement. Identical retries survive runtime restart, conflicting replies are rejected, and
failed admission leaves the form open. Provider delivery runs from that durable queue; an
unconfirmed delivery pauses it with an actionable error. Cancellation closes admission to provider
events immediately.

## Reference and scope

Reviewed T3 Code's [orchestrator v2 branch](https://github.com/pingdotgg/t3code/pull/2829), revision
`3e4ca4c532f9746f8ce62acfa80b8a6ea30e962b`, particularly `CommandReceiptStore`,
`RunFinalizationService`, `ProviderRuntimeRecoveryService`, and the architecture guide. These
changes apply its durable-intent and runtime-ownership principles to Dovo's existing Effect 3
runtime. They do not replace Dovo's workspace storage with T3's event log/outbox or change its
provider lock, HTTP/VPN connectivity, device pairing, or restart-continuation preference.
