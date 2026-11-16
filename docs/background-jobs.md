# Background job investigation

The reported “remove gitops local image” incident was investigated against Studio's source code. The
colleague's runtime database, transcript and running process were not available in this checkout, so
the original timeline and current test-process state have not been independently verified.

## Confirmed code paths

- Claude's explicit `local_bash` background tasks were excluded from native task tracking. Studio
  could therefore hide a Monitor job and consider its provider session idle while it was still
  working. Idle-session cleanup can close that session and stop its monitor.
- After a parent result, Claude assistant messages were ignored by turn-owned transcript callbacks.
  This could lose a late root reply even while the provider session remained open.
- Automatically accepted child results retained the `queued` completion state. Their durable inbox
  entry was consumed, but the child metadata did not reflect acceptance.
- Compact desktop rows did not display a status icon for unread completion or input requests.

## Changes

Explicit background command/Monitor events now appear as **Background: …** rows in the existing
child-work tree on desktop and mobile. They keep the Claude session owned while running, preserve
saved status/output, and participate in existing stop controls. Foreground shell commands and
ambient internal tasks are excluded. Background jobs show saved output rather than attempting to
read an agent transcript.

Late canonical root replies are saved once by message identity through a session-owned callback.
Stale or closed sessions cannot append them. Saved replies are also marked as already present in the
provider session, so the next follow-up does not feed them back as new context. Claude retains
responsibility for delivering its background command notification; Studio does not inject a second
copy as a new prompt.

A finished background task can wake Claude's main agent when no Studio turn is active. Studio shows
that work as a **Main agent: …** row with the session's own ID. The row keeps the thread working and
the session owned, Stop interrupts it, and its finish is never queued as a child result. Its tools
use the policy of the last turn, but only while the thread still has that session and the same
permission, approval policy and sandbox mode. After a change, the pre-use hook denies every tool. A
new message waits up to 10 minutes for the woken agent's result, so that result cannot end the new
turn early. The wait ends when the turn is cancelled.

Child results change to read when their receiving prompt is accepted, in the same transaction as the
acceptance record. Result-version checks prevent an old acknowledgement consuming a newer result.
Existing inbox receipts continue to deduplicate repeated delivery and survive restarts.

A successful thread shows Done only while its completed response is unread. Viewing it clears the
Done indicator; a later completed turn makes it reappear. Needs input uses yellow on desktop and
mobile, and compact desktop rows show status icons for unread completion and input requests.

## Verification and limits

Tests cover Claude background starts and roster recovery under memory pressure, late reply
persistence/deduplication, stale session rejection, background-output reads, notification delivery,
child acceptance and restart recovery. Browser checks cover desktop/mobile child rendering, sidebar
stability and compact status visibility.

The reported duplicate Fable result still needs the original delivery trace to distinguish repeated
transport from an explicit second read. The receipt and notification changes above address the
confirmed paths; they do not establish the cause of that specific incident.

`spawn codex ENOENT` means the configured Codex executable was unavailable on the runtime host. Its
installation/path must be corrected there. A project health check accepting HTTP 404 is that
project's test logic and is outside Studio's runtime fix.

A detached script started with `nohup` remains an independent process. Stopping its Studio monitor
does not necessarily stop that script. These changes preserve and display monitors; they do not turn
arbitrary detached commands into supervised processes or recover results from an already killed
monitor without a new prompt. Runtime shutdown still ends native provider sessions.
