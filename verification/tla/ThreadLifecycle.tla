---------------------------- MODULE ThreadLifecycle ----------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS MaxAttempts, MaxQueue, CheckAttempt, RecheckArchive, RecheckWorktreeOwner, ReserveWorktreeOwner
VARIABLE thread

\* One ordinary thread family on one runtime. A separate Handoff model checks
\* source/destination ownership. The phase and run fields change independently.
Phases == {"absent", "draft", "open", "settled", "archived", "deleted"}
Runs == {"idle", "running", "waiting", "saving", "interrupted"}
Outcomes == {"completed", "failed", "cancelled"}
Operations == {"none", "autoSettle", "autoArchive", "archive", "delete", "sandbox"}
Attempts == 1..MaxAttempts
Inputs == {1, 2}

Init ==
  thread = [phase |-> "absent", run |-> "idle", snoozed |-> FALSE,
            queue |-> <<>>, paused |-> FALSE, attempt |-> 0, input |-> 0,
            outcome |-> "none", results |-> {}, operation |-> "none",
            eligible |-> TRUE, ownership |-> "local", worktree |-> "none", worktreeCleanup |-> "idle",
            staleResult |-> FALSE, staleArchive |-> FALSE, staleRemoval |-> FALSE]

Reserved == thread.operation \in {"archive", "delete", "sandbox"}
            \/ (ReserveWorktreeOwner /\ thread.worktreeCleanup = "removing")
Present == thread.phase \in {"draft", "open", "settled", "archived"}
Local == thread.ownership = "local"
CanWork == thread.phase \in {"draft", "open"} /\ ~Reserved /\ Local
Idle == thread.run = "idle"
AutoEligible == thread.phase \in {"open", "settled"} /\ Idle /\ Local
                /\ Len(thread.queue) = 0 /\ thread.eligible

Create ==
  /\ thread.phase = "absent"
  /\ thread' = [thread EXCEPT !.phase = "draft", !.worktree = "present"]

Enqueue(input) ==
  /\ CanWork /\ Len(thread.queue) < MaxQueue
  /\ thread' = [thread EXCEPT !.queue = Append(@, input)]

PauseQueue(paused) ==
  /\ CanWork /\ thread.paused # paused
  /\ thread' = [thread EXCEPT !.paused = paused]

StartNext ==
  /\ CanWork /\ Idle /\ ~thread.paused /\ Len(thread.queue) > 0
  /\ thread.attempt < MaxAttempts
  /\ thread' = [thread EXCEPT !.phase = "open", !.run = "running", !.queue = Tail(@),
                 !.input = Head(thread.queue), !.attempt = @ + 1,
                 !.snoozed = FALSE]

WaitForInput ==
  /\ CanWork /\ thread.run = "running"
  /\ thread' = [thread EXCEPT !.run = "waiting"]

Answer ==
  /\ CanWork /\ thread.run = "waiting"
  /\ thread' = [thread EXCEPT !.run = "running"]

Finish(attempt, outcome) ==
  /\ CanWork /\ thread.run \in {"running", "waiting"}
  /\ attempt <= thread.attempt
  /\ (~CheckAttempt \/ attempt = thread.attempt)
  /\ thread' = [thread EXCEPT !.run = "saving", !.outcome = outcome,
                 !.staleResult = @ \/ attempt # thread.attempt]

SaveResult(ready) ==
  /\ thread.run = "saving"
  /\ thread' = IF ready
               THEN [thread EXCEPT !.run = "idle", !.outcome = "none", !.input = 0,
                     !.results = @ \cup {<<thread.attempt, thread.outcome>>}]
               ELSE [thread EXCEPT !.paused = TRUE]

Restart ==
  /\ CanWork /\ thread.run \in {"running", "waiting", "saving"}
  /\ thread' = [thread EXCEPT !.paused = TRUE,
                 !.run = IF @ = "saving" THEN @ ELSE "interrupted"]

ResumeInterrupted ==
  /\ CanWork /\ thread.run = "interrupted" /\ thread.attempt < MaxAttempts
  /\ thread' = [thread EXCEPT !.run = "running", !.attempt = @ + 1]

Snooze(snoozed) ==
  /\ CanWork /\ Idle /\ thread.snoozed # snoozed
  /\ thread' = [thread EXCEPT !.snoozed = snoozed]

Settle ==
  /\ CanWork /\ Idle /\ thread.phase = "open"
  /\ thread' = [thread EXCEPT !.phase = "settled", !.snoozed = FALSE]

Restore ==
  /\ thread.phase \in {"settled", "archived"} /\ ~Reserved /\ Local
  /\ thread' = [thread EXCEPT !.phase = "open", !.snoozed = FALSE,
                 !.eligible = FALSE]

BeginAutomatic(op) ==
  /\ thread.operation = "none" /\ AutoEligible
  /\ (op # "autoSettle" \/ thread.phase = "open")
  /\ thread' = [thread EXCEPT !.operation = op]

\* One observation represents family, policy or activity changing during cleanup.
LoseEligibility ==
  /\ thread.operation \in {"autoSettle", "autoArchive"}
  /\ thread' = [thread EXCEPT !.eligible = FALSE]

FinishAutomatic ==
  /\ thread.operation \in {"autoSettle", "autoArchive"}
  /\ LET eligible == AutoEligible
                        /\ (thread.operation # "autoSettle" \/ thread.phase = "open")
         commit == eligible \/ (~RecheckArchive /\ thread.operation = "autoArchive")
     IN IF commit
        THEN thread' = [thread EXCEPT
             !.phase = IF thread.operation = "autoArchive" THEN "archived" ELSE "settled",
             !.operation = IF thread.operation = "autoArchive" THEN "sandbox" ELSE "none",
             !.snoozed = FALSE, !.staleArchive = @ \/ ~eligible]
        ELSE thread' = [thread EXCEPT !.operation = "none"]

BeginManual(op) ==
  /\ Present /\ Idle /\ ~Reserved /\ thread.operation = "none"
  /\ thread.ownership # "transferring"
  /\ thread' = [thread EXCEPT !.operation = op]

FailManual ==
  /\ thread.operation \in {"archive", "delete"}
  /\ thread' = [thread EXCEPT !.operation = "none"]

CommitManual ==
  /\ thread.operation \in {"archive", "delete"}
  /\ thread' = [thread EXCEPT
       !.phase = IF thread.operation = "archive" THEN "archived" ELSE "deleted",
       !.operation = "sandbox", !.snoozed = FALSE,
       !.queue = IF thread.operation = "delete" THEN <<>> ELSE @,
       !.results = IF thread.operation = "delete" THEN {} ELSE @]

FinishSandbox ==
  /\ thread.operation = "sandbox"
  /\ thread' = [thread EXCEPT !.operation = "none"]

\* These are the source-side boundaries. Handoff.tla checks destination activation.
BeginHandoff ==
  /\ thread.phase \in {"open", "settled"} /\ Local /\ Idle
  /\ thread.operation = "none" /\ Len(thread.queue) = 0
  /\ thread' = [thread EXCEPT !.ownership = "transferring"]

FinishHandoff(moved) ==
  /\ thread.ownership = "transferring"
  /\ thread' = [thread EXCEPT !.ownership = IF moved THEN "moved" ELSE "local"]

\* Inspect the worktree, then admit removal against fresh ownership.
WorktreeRemovable == thread.phase \in {"archived", "deleted"}

ProbeWorktree ==
  /\ thread.phase = "archived" /\ thread.worktree = "present"
  /\ thread.worktreeCleanup = "idle"
  /\ thread' = [thread EXCEPT !.worktreeCleanup = "checking"]

AdmitWorktreeRemoval ==
  /\ thread.worktreeCleanup = "checking" /\ ~Reserved
  /\ thread' = [thread EXCEPT
       !.worktreeCleanup = IF WorktreeRemovable \/ ~RecheckWorktreeOwner
                           THEN "removing" ELSE "idle"]

FinishWorktreeRemoval(removed) ==
  /\ thread.worktreeCleanup = "removing"
  /\ thread' = [thread EXCEPT !.worktreeCleanup = "idle",
       !.worktree = IF removed THEN "removed" ELSE @,
       !.staleRemoval = @ \/ (removed /\ ~WorktreeRemovable)]

ReattachWorktree ==
  /\ CanWork /\ thread.worktree = "removed"
  /\ thread' = [thread EXCEPT !.worktree = "present"]

Next ==
  \/ Create \/ StartNext \/ WaitForInput \/ Answer \/ Restart \/ ResumeInterrupted
  \/ \E input \in Inputs : Enqueue(input)
  \/ \E attempt \in Attempts, outcome \in Outcomes : Finish(attempt, outcome)
  \/ \E flag \in BOOLEAN : PauseQueue(flag) \/ SaveResult(flag) \/ Snooze(flag)
  \/ Settle \/ Restore
  \/ \E op \in {"autoSettle", "autoArchive"} : BeginAutomatic(op)
  \/ LoseEligibility \/ FinishAutomatic
  \/ \E op \in {"archive", "delete"} : BeginManual(op)
  \/ FailManual \/ CommitManual \/ FinishSandbox
  \/ BeginHandoff \/ \E moved \in BOOLEAN : FinishHandoff(moved)
  \/ ProbeWorktree \/ AdmitWorktreeRemoval \/ ReattachWorktree
  \/ \E removed \in BOOLEAN : FinishWorktreeRemoval(removed)
  \/ UNCHANGED thread

Spec == Init /\ [][Next]_thread

TypeOK ==
  /\ thread.phase \in Phases /\ thread.run \in Runs /\ thread.operation \in Operations
  /\ thread.attempt \in 0..MaxAttempts /\ thread.input \in Inputs \cup {0}
  /\ Len(thread.queue) <= MaxQueue
  /\ \A i \in 1..Len(thread.queue) : thread.queue[i] \in Inputs
  /\ thread.outcome \in Outcomes \cup {"none"}
  /\ thread.results \subseteq (Attempts \X Outcomes)
  /\ thread.ownership \in {"local", "transferring", "moved"}
  /\ thread.worktree \in {"none", "present", "removed"}
  /\ thread.worktreeCleanup \in {"idle", "checking", "removing"}
  /\ \A flag \in {thread.snoozed, thread.paused, thread.eligible,
                   thread.staleResult, thread.staleArchive, thread.staleRemoval} : flag \in BOOLEAN

ExecutionRequiresOpenThread == thread.run # "idle" => (CanWork /\ thread.phase = "open")
OnlyOneSavedOutcomePerAttempt ==
  \A attempt \in Attempts :
    Cardinality({result \in thread.results : result[1] = attempt}) <= 1
PendingOutcomeRequiresSave ==
  thread.run = "saving" <=> thread.outcome \in Outcomes
SandboxCleanupRequiresArchiveOrDelete ==
  thread.operation = "sandbox" => thread.phase \in {"archived", "deleted"}
DeletedThreadHasNoWork ==
  thread.phase = "deleted" => (Idle /\ Len(thread.queue) = 0 /\ thread.results = {})
OnlyCurrentAttemptCanFinish == ~thread.staleResult
AutomaticArchiveRequiresCurrentEligibility == ~thread.staleArchive
WorktreeRemovalRequiresArchivedOrDeletedOwner == ~thread.staleRemoval
=============================================================================
