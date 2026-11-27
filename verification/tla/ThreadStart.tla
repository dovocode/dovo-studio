------------------------------- MODULE ThreadStart -------------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS AtomicBootstrap, DeduplicateFirstInput, RecheckSideParent, CheckDelegationRun,
          RecheckForkSource, CheckForkDeletion, CheckCurrentSidePermission
VARIABLE start

Payloads == {1, 2}
Runs == {1, 2}
Keys == {1, 2}
Slots == Runs \X Keys
NoChild == [payload |-> 0, phase |-> "absent"]
Unavailable == {"reserved", "archived", "deleted"}

\* Check each entry point independently, with the same bounds in one TLC run.
Init ==
  \/ start = [kind |-> "root", phase |-> "absent", receipt |-> 0,
              accepted |-> 0, acknowledgement |-> FALSE]
  \/ \E kind \in {"side", "fork"} :
     start = [kind |-> kind, parent |-> "open", busy |-> FALSE,
              phase |-> "absent", pending |-> 0, payload |-> 0,
              source |-> "none", permission |-> "write", capturedPermission |-> "write",
              createdFromUnavailable |-> FALSE, resurrected |-> FALSE,
              admittedAboveCeiling |-> FALSE]
  \/ \E depth \in 0..3 :
     start = [kind |-> "delegation", parentRun |-> 0, lastRun |-> 0,
              depth |-> depth, children |-> [slot \in Slots |-> NoChild],
              admittedWithoutParent |-> FALSE]

\* The draft and bootstrap identity commit together. The first input is accepted separately.
RootCommit(payload, ready) ==
  /\ start.phase = "absent"
  /\ IF ready
     THEN start' = [start EXCEPT !.phase = "open", !.receipt = payload]
     ELSE IF AtomicBootstrap THEN UNCHANGED start
          ELSE start' = [start EXCEPT !.phase = "open"]

RootAccept(payload) ==
  /\ start.phase = "open" /\ start.receipt = payload
  /\ start.accepted < 2 /\ (~DeduplicateFirstInput \/ start.accepted = 0)
  /\ start' = [start EXCEPT !.accepted = @ + 1]

RootAcknowledge(payload) ==
  /\ start.receipt = payload /\ start.accepted > 0
  /\ start' = [start EXCEPT !.acknowledgement = TRUE]

RootDelete ==
  /\ start.phase = "open"
  /\ start' = [start EXCEPT !.phase = "deleted"]

RootRestart ==
  start' = [start EXCEPT !.acknowledgement = FALSE]

\* A conflicting input is rejected. A receipt can be replayed after deletion,
\* but deleting a thread makes it ineligible for another commit.
RootNext ==
  \/ \E payload \in Payloads, ready \in BOOLEAN : RootCommit(payload, ready)
  \/ \E payload \in Payloads : RootAccept(payload) \/ RootAcknowledge(payload)
  \/ RootDelete \/ RootRestart

ParentChange ==
  \/ /\ start.parent = "open" /\ start' = [start EXCEPT !.parent = "reserved"]
  \/ /\ start.parent = "reserved"
     /\ \E next \in {"open", "archived", "deleted"} : start' = [start EXCEPT !.parent = next]
  \/ /\ start.parent = "archived" /\ start' = [start EXCEPT !.parent = "open"]

BeginDerived(payload) ==
  /\ start.parent = "open" /\ start.pending = 0
  /\ (start.phase = "absent" \/
      (start.kind = "fork" /\ ~CheckForkDeletion /\ start.phase = "deleted"))
  /\ start' = [start EXCEPT !.pending = payload,
       !.source = IF start.kind = "fork" \/ start.busy THEN "head" ELSE "snapshot"]

CommitDerived ==
  /\ start.pending \in Payloads
  /\ (start.parent = "open" \/
      IF start.kind = "fork" THEN ~RecheckForkSource ELSE ~RecheckSideParent)
  /\ (start.source # "snapshot" \/ ~start.busy)
  /\ start' = [start EXCEPT !.phase = "draft", !.payload = start.pending, !.pending = 0,
       !.capturedPermission = start.permission,
       !.resurrected = @ \/ start.phase = "deleted",
       !.createdFromUnavailable = (start.parent \in Unavailable)]

RejectDerived ==
  /\ start.pending \in Payloads
  /\ start' = [start EXCEPT !.pending = 0, !.source = "none"]

StartDerived(access) ==
  /\ start.phase = "draft"
  /\ (start.kind = "fork" \/
       (start.parent # "deleted" /\
        (access = "read" \/
         (start.capturedPermission = "write" /\ (~CheckCurrentSidePermission \/ start.permission = "write")))))
  /\ start' = [start EXCEPT !.phase = "running",
       !.admittedAboveCeiling = @ \/ (start.kind = "side" /\ access = "write" /\ start.permission = "read")]

DerivedNext ==
  \/ ParentChange \/ CommitDerived \/ RejectDerived
  \/ \E payload \in Payloads : BeginDerived(payload)
  \/ \E access \in {"read", "write"} : StartDerived(access)
  \/ /\ start.parent # "deleted" /\ start' = [start EXCEPT !.busy = ~@]
  \/ \E permission \in {"read", "write"} : start' = [start EXCEPT !.permission = permission]
  \/ /\ start.phase = "draft" /\ start' = [start EXCEPT !.phase = "deleted"]

\* One active-child slot. A key is scoped to a parent run, not the parent thread.
ActiveChildren ==
  {slot \in Slots : start.children[slot].phase \in {"draft", "running"}}

BeginParentRun ==
  /\ start.parentRun = 0 /\ start.lastRun < 2
  /\ start' = [start EXCEPT !.lastRun = @ + 1, !.parentRun = start.lastRun + 1]

StopParentRun ==
  /\ start.parentRun \in Runs
  /\ start' = [start EXCEPT !.parentRun = 0]

Spawn(run, key, payload) ==
  /\ start.parentRun = run /\ start.depth < 3
  /\ LET slot == <<run, key>>
     IN IF start.children[slot].phase # "absent"
        THEN /\ start.children[slot].payload = payload /\ UNCHANGED start
        ELSE /\ Cardinality(ActiveChildren) < 1
             /\ start' = [start EXCEPT !.children[slot] = [payload |-> payload, phase |-> "draft"]]

StartChild(slot) ==
  /\ start.children[slot].phase = "draft"
  /\ (~CheckDelegationRun \/ start.parentRun = slot[1])
  /\ start' = [start EXCEPT !.children[slot].phase = "running",
                 !.admittedWithoutParent = @ \/ start.parentRun # slot[1]]

RetireChild(slot) ==
  /\ slot \in ActiveChildren
  /\ start' = [start EXCEPT !.children[slot].phase = "ended"]

DelegationNext ==
  \/ BeginParentRun \/ StopParentRun
  \/ \E run \in Runs, key \in Keys, payload \in Payloads : Spawn(run, key, payload)
  \/ \E slot \in Slots : StartChild(slot) \/ RetireChild(slot)

Next ==
  \/ CASE start.kind = "root" -> RootNext
       [] start.kind = "delegation" -> DelegationNext
       [] OTHER -> DerivedNext
  \/ UNCHANGED start

Spec == Init /\ [][Next]_start

RootStartIsAtomic ==
  IF start.kind = "root"
  THEN (start.phase \in {"open", "deleted"}) <=> (start.receipt \in Payloads)
  ELSE TRUE

FirstInputAcceptedAtMostOnce ==
  IF start.kind = "root" THEN start.accepted <= 1 ELSE TRUE

DurableStartIdentity ==
  [][CASE start.kind = "root" ->
           /\ (start.receipt \in Payloads => start'.receipt = start.receipt)
           /\ (start.phase = "deleted" => start'.phase = "deleted")
       [] start.kind = "delegation" ->
           \A slot \in Slots :
             start.children[slot].payload \in Payloads =>
               start'.children[slot].payload = start.children[slot].payload
       [] OTHER -> start.payload \in Payloads => start'.payload = start.payload]_start

SideCreationRequiresAvailableParent ==
  IF start.kind = "side" THEN ~start.createdFromUnavailable ELSE TRUE

ForkCreationRequiresAvailableSource ==
  IF start.kind = "fork" THEN ~start.createdFromUnavailable ELSE TRUE

DeletedForkStaysDeleted ==
  IF start.kind = "fork" THEN ~start.resurrected ELSE TRUE

SideStartRespectsCurrentPermission ==
  IF start.kind = "side" THEN ~start.admittedAboveCeiling ELSE TRUE

ChildStartsUnderItsOwnParentRun ==
  IF start.kind = "delegation" THEN ~start.admittedWithoutParent ELSE TRUE

DelegationLimits ==
  IF start.kind = "delegation"
  THEN Cardinality(ActiveChildren) <= 1 /\ (start.depth = 3 => ActiveChildren = {})
  ELSE TRUE

IndependentForkUsesCommittedHead ==
  IF start.kind = "fork" /\ start.phase \in {"draft", "running"} THEN start.source = "head"
  ELSE TRUE
=============================================================================
