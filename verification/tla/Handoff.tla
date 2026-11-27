------------------------------- MODULE Handoff -------------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Ids, CheckTransferOnClear
ASSUME 0 \notin Ids

\* One thread on the source. The destination has a receipt for each transfer.
\* current/phase are the source task projection; fence is a separate SQLite row.
VARIABLES current, phase, fence, destination, activationSent
vars == <<current, phase, fence, destination, activationSent>>

Init ==
  /\ current = 0 /\ phase = "owned" /\ fence = 0
  /\ destination = [i \in Ids |-> "absent"] /\ activationSent = {}

Begin(i) ==
  /\ phase = "owned" /\ destination[i] = "absent"
  /\ current' = i /\ phase' = "blocked"
  /\ UNCHANGED <<fence, destination, activationSent>>

Stage(i) ==
  /\ current = i /\ phase = "blocked" /\ destination[i] = "absent"
  /\ destination' = [destination EXCEPT ![i] = "staged"]
  /\ UNCHANGED <<current, phase, fence, activationSent>>

RecordMove(i) ==
  /\ current = i /\ phase = "blocked" /\ destination[i] = "staged"
  /\ phase' = "moved" /\ fence' = i
  /\ UNCHANGED <<current, destination, activationSent>>

SendActivation(i) ==
  /\ current = i /\ phase = "moved" /\ fence = i
  /\ activationSent' = activationSent \cup {i}
  /\ UNCHANGED <<current, phase, fence, destination>>

Activate(i) ==
  /\ i \in activationSent /\ destination[i] = "staged"
  /\ destination' = [destination EXCEPT ![i] = "active"]
  /\ UNCHANGED <<current, phase, fence, activationSent>>

DeleteStaged(i) ==
  /\ destination[i] = "staged"
  /\ destination' = [destination EXCEPT ![i] = "discarded"]
  /\ UNCHANGED <<current, phase, fence, activationSent>>

\* A retry or repeated cancel can observe an older durable discard again.
ApplyDiscard(i) ==
  /\ destination[i] = "discarded"
  /\ current' = IF current = i THEN 0 ELSE current
  /\ phase' = IF current = i THEN "owned" ELSE phase
  /\ fence' = IF ~CheckTransferOnClear \/ fence = i THEN 0 ELSE fence
  /\ UNCHANGED <<destination, activationSent>>

\* Reconcile the saved task projection from the authoritative fence before work.
RestartSource ==
  /\ IF fence # 0 THEN /\ current' = fence /\ phase' = "moved"
     ELSE IF phase = "moved" THEN /\ current' = 0 /\ phase' = "owned"
     ELSE UNCHANGED <<current, phase>>
  /\ UNCHANGED <<fence, destination, activationSent>>

Next ==
  \/ \E i \in Ids : Begin(i) \/ Stage(i) \/ RecordMove(i) \/ SendActivation(i)
                     \/ Activate(i) \/ DeleteStaged(i) \/ ApplyDiscard(i)
  \/ RestartSource
Spec == Init /\ [][Next]_vars
OneExecutor ==
  (IF phase = "owned" THEN 1 ELSE 0) + Cardinality({i \in Ids : destination[i] = "active"}) <= 1
=============================================================================
