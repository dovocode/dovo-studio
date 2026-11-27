------------------------------ MODULE MobileThread ------------------------------
EXTENDS Naturals

CONSTANTS UseOriginalComputer, PreserveForkEdits, ScopeCachedHistory, DeduplicateRestore,
          MatchAnswerRevision
VARIABLE state

Computers == {"first", "second"}
Drafts == {"request", "new draft"}
Origin == "first"
DeferredModes == {"queue", "stage"}
Modes == DeferredModes \union {"direct", "steer"}

\* Both computers can have the same task ID. The journal and all remote receipts
\* include the destination, regardless of the computer currently on screen.
Init ==
  \/ \E modern \in BOOLEAN :
     state = [kind |-> "send", modern |-> modern, screen |-> Origin,
              online |-> TRUE, foreground |-> TRUE, draft |-> "request",
              captured |-> "none", edited |-> FALSE, mode |-> "none",
              run |-> 1, targetRun |-> 0, accepted |-> FALSE, replied |-> FALSE,
              confirmed |-> FALSE, wrongOwner |-> FALSE]
  \/ \E operation \in {"fork", "restore", "side"} :
     state = [kind |-> "draft action", operation |-> operation, screen |-> Origin,
              online |-> TRUE, foreground |-> TRUE, draft |-> "request",
              staged |-> FALSE, captured |-> "none", edited |-> FALSE,
              applied |-> FALSE, reply |-> FALSE, confirmed |-> FALSE,
              erasedEdit |-> FALSE, appended |-> 0, opened |-> "none"]
  \/ state = [kind |-> "history", screen |-> Origin, online |-> TRUE,
              pending |-> "none", pendingRevision |-> 0, detail |-> "none",
              detailRevision |-> 0, lifecycle |-> "open", revision |-> 0]
  \/ state = [kind |-> "answer", screen |-> Origin, online |-> TRUE,
              pending |-> TRUE, saved |-> 1, captured |-> 0, accepted |-> FALSE,
              erasedEdit |-> FALSE]

ChangeScreen ==
  \E computer \in Computers : state' = [state EXCEPT !.screen = computer]

ChangeConnection ==
  state' = [state EXCEPT !.online = ~@]

\* Staging saves the text/settings envelope before transport. Current clients can
\* release a deferred send after the outbox is durable, even without an HTTP reply.
StageSend(mode) ==
  /\ state.mode = "none" /\ state.draft \in Drafts /\ state.screen = Origin
  /\ state.foreground
  /\ (state.online \/ mode \in DeferredModes)
  /\ (mode # "stage" \/ state.modern)
  /\ (mode # "direct" \/ state.modern)
  /\ state' = [state EXCEPT !.mode = mode, !.captured = state.draft,
      !.targetRun = IF mode = "steer" THEN state.run ELSE 0]

Dispatch ==
  IF state.kind = "send" THEN
    /\ state.mode \in Modes /\ state.online /\ state.foreground /\ ~state.accepted
    /\ (state.mode # "steer" \/ state.run = state.targetRun)
    /\ (state.mode \in DeferredModes \/ state.screen = Origin)
    /\ LET target == IF UseOriginalComputer THEN Origin ELSE state.screen
       IN state' = [state EXCEPT !.accepted = TRUE, !.wrongOwner = (target # Origin)]
  ELSE FALSE

ConfirmSend ==
  IF state.kind = "send" THEN
    /\ ~state.confirmed /\ state.foreground
    /\ (state.replied \/ (state.accepted /\ state.online) \/ state.mode \in DeferredModes)
    /\ state' = [state EXCEPT !.confirmed = TRUE,
       !.draft = IF ~state.edited /\ @ = state.captured THEN "none" ELSE @]
  ELSE FALSE

SendNext ==
  \/ \E mode \in Modes : StageSend(mode)
  \/ Dispatch \/ ConfirmSend
  \/ /\ state.accepted /\ state.online /\ state.foreground
     /\ state' = [state EXCEPT !.replied = TRUE]
  \/ /\ state.run = 1 /\ state' = [state EXCEPT !.run = 2]
  \/ \E draft \in Drafts : state' = [state EXCEPT !.draft = draft,
         !.edited = @ \/ state.mode \in Modes]
  \/ state' = [state EXCEPT !.foreground = ~@, !.replied = FALSE]
  \/ ChangeScreen \/ ChangeConnection

\* Fork and queue restore retain a local journal after process loss. The side-thread
\* journal retains one ID for the objective. Runtime retries reuse the same result.
ConfirmDraftAction ==
  /\ state.applied /\ state.reply /\ ~state.confirmed /\ state.foreground
  /\ LET clear == state.operation = "fork" /\ state.draft = state.captured
                    /\ (~PreserveForkEdits \/ ~state.edited)
     IN state' = [state EXCEPT !.confirmed = TRUE,
            !.draft = IF clear THEN "none" ELSE @,
            !.erasedEdit = @ \/ (clear /\ state.edited),
            !.appended = IF state.operation = "restore" THEN @ + 1 ELSE @]

DraftActionNext ==
  \/ /\ ~state.staged /\ state.online /\ state.foreground /\ state.screen = Origin
     /\ state' = [state EXCEPT !.staged = TRUE, !.captured = state.draft]
  \/ /\ state.staged /\ state.online /\ state.foreground /\ state.screen = Origin
     /\ state' = [state EXCEPT !.applied = TRUE]
  \/ /\ state.applied /\ state.online /\ state.foreground
     /\ state' = [state EXCEPT !.reply = TRUE]
  \/ ConfirmDraftAction
  \/ /\ state.operation = "restore" /\ state.reply /\ state.confirmed
     /\ ~DeduplicateRestore /\ state.appended < 2
     /\ state' = [state EXCEPT !.appended = @ + 1]
  \/ /\ state.operation \in {"fork", "side"} /\ state.confirmed /\ state.screen = Origin
     /\ state' = [state EXCEPT !.opened = Origin]
  \/ \E draft \in Drafts : state' = [state EXCEPT !.draft = draft, !.edited = @ \/ state.staged,
                                                 !.opened = "none"]
  \/ state' = [state EXCEPT !.foreground = ~@, !.reply = FALSE, !.opened = "none"]
  \/ \E computer \in Computers : state' = [state EXCEPT !.screen = computer, !.opened = "none"]
  \/ ChangeConnection

\* A cached detail read can return after navigation or a history revision. The
\* authoritative thread record owns archive, restore, snooze and delete.
CanPublishHistory ==
  ~ScopeCachedHistory \/ (state.pending = state.screen /\ state.pendingRevision = state.revision)

HistoryNext ==
  \/ \E computer \in Computers :
     state' = [state EXCEPT !.screen = computer, !.detail = "none"]
  \/ /\ state.pending = "none"
     /\ state' = [state EXCEPT !.pending = state.screen, !.pendingRevision = state.revision]
  \/ /\ state.pending \in Computers
     /\ state' = [state EXCEPT !.pending = "none",
          !.detail = IF CanPublishHistory THEN state.pending ELSE @,
          !.detailRevision = IF CanPublishHistory THEN state.pendingRevision ELSE @]
  \/ /\ state.online /\ state.lifecycle # "deleted"
     /\ \E lifecycle \in {"open", "snoozed", "archived", "deleted"} :
        state' = [state EXCEPT !.lifecycle = lifecycle]
  \/ /\ state.online /\ state.revision = 0
     /\ state' = [state EXCEPT !.revision = 1, !.detail = "none"]
  \/ ChangeConnection

\* A form can be shown on the parent, but the saved answer and its files belong
\* to the original question. A late completion may remove only the version it sent.
AnswerNext ==
  \/ /\ state.online /\ state.screen = Origin /\ state.pending
     /\ state.saved > 0 /\ state.captured = 0
     /\ state' = [state EXCEPT !.captured = state.saved]
  \/ /\ state.online /\ state.screen = Origin /\ state.pending
     /\ state.captured > 0 /\ state.captured = state.saved
     /\ state' = [state EXCEPT !.accepted = TRUE, !.pending = FALSE]
  \/ /\ state.saved = 1 /\ state' = [state EXCEPT !.saved = 2]
  \/ /\ state.pending /\ state' = [state EXCEPT !.pending = FALSE]
  \/ /\ state.accepted /\ state.captured > 0
     /\ LET clear == ~MatchAnswerRevision \/ state.saved = state.captured
        IN state' = [state EXCEPT !.captured = 0,
            !.erasedEdit = @ \/ (clear /\ state.saved # state.captured),
            !.saved = IF clear THEN 0 ELSE @]
  \/ ChangeScreen \/ ChangeConnection

Next ==
  \/ CASE state.kind = "send" -> SendNext
       [] state.kind = "draft action" -> DraftActionNext
       [] state.kind = "history" -> HistoryNext
       [] OTHER -> AnswerNext
  \/ UNCHANGED state

Spec == Init /\ [][Next]_state

RecoverySpec == Spec /\ WF_state(Dispatch) /\ WF_state(ConfirmSend)

DeliveryTargetsOwner ==
  IF state.kind = "send" THEN ~state.wrongOwner ELSE TRUE

ConfirmedSendHasDurableOwner ==
  IF state.kind = "send" /\ state.confirmed
  THEN state.accepted \/ state.mode \in DeferredModes
  ELSE TRUE

ForkReplyPreservesEditedDraft ==
  IF state.kind = "draft action" THEN ~state.erasedEdit ELSE TRUE

RestoreAppendsOnce ==
  IF state.kind = "draft action" THEN state.appended <= 1 ELSE TRUE

DerivedNavigationStaysInScope ==
  IF state.kind = "draft action" THEN state.opened \in {"none", state.screen} ELSE TRUE

CachedHistoryStaysInScope ==
  IF state.kind = "history" /\ state.detail # "none"
  THEN state.detail = state.screen /\ state.detailRevision = state.revision
  ELSE TRUE

AnswerReplyPreservesEditedDraft ==
  IF state.kind = "answer" THEN ~state.erasedEdit ELSE TRUE

ConnectionUsable ==
  IF state.kind = "send" THEN state.online /\ state.foreground ELSE TRUE

DeferredSendStaged ==
  IF state.kind = "send" THEN state.mode \in DeferredModes ELSE FALSE

DeferredSendSettled ==
  IF state.kind = "send" THEN state.accepted /\ state.confirmed ELSE FALSE

DeferredSendEventuallySettles ==
  (<>[]ConnectionUsable) => (DeferredSendStaged ~> DeferredSendSettled)
=============================================================================
