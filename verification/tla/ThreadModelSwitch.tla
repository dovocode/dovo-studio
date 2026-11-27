--------------------------- MODULE ThreadModelSwitch ---------------------------
EXTENDS Naturals, Sequences

CONSTANTS PersistBeforeAdmission, CheckDiscovery, CheckRetirement
VARIABLE state

NoChoice == "inherit"
Settings(model, effort, tier, access) ==
  [model |-> model, effort |-> effort, tier |-> tier, access |-> access]
Default == Settings("small", "low", "fast", "write")
QueueChoices == {Settings(NoChoice, "none", "none", "write"),
                 Settings("small", "low", "fast", "read"),
                 Settings("large", "high", "none", "read"),
                 Settings("large", "high", "none", "write")}
NoRun == Settings("none", "none", "none", "none")

Init ==
  \/ \E persistent \in BOOLEAN :
     state = [kind |-> "queue", persistent |-> persistent,
              queue |-> <<>>, defaults |-> Default, admittedDefault |-> Default,
              run |-> NoRun, admitted |-> NoRun, phase |-> "idle"]
  \/ state = [kind |-> "discovery", generation |-> 0, captured |-> 0,
              mode |-> "automatic", pending |-> FALSE, available |-> TRUE,
              invalidCommit |-> FALSE]
  \/ state = [kind |-> "handoff", harness |-> "old", phase |-> "running",
              pending |-> FALSE, stop |-> FALSE, queued |-> FALSE,
              overrides |-> FALSE, session |-> "old", receipt |-> FALSE,
              invalidCommit |-> FALSE]

\* Each item carries a model (and, for a full override, access) or inherits at admission.
\* Only model settings become the thread default. Access remains specific to the queued turn.
ChooseModel(item) ==
  IF item.model = NoChoice THEN state.defaults ELSE item

ModelDefaults(choice, defaults) == [choice EXCEPT !.access = defaults.access]

ConfigureQueue(queue, item) ==
  state' = [state EXCEPT !.queue = queue,
      !.defaults = IF PersistBeforeAdmission /\ state.persistent /\ item.model # NoChoice
                   THEN ModelDefaults(item, @) ELSE @]

Admit ==
  /\ state.phase = "idle" /\ Len(state.queue) > 0
  /\ LET item == Head(state.queue)
         model == ChooseModel(item)
         expected == IF item.model = NoChoice THEN state.admittedDefault ELSE item
     IN state' = [state EXCEPT !.queue = Tail(@), !.run = model, !.admitted = expected,
           !.phase = "running",
           !.defaults = IF state.persistent THEN ModelDefaults(model, @) ELSE @,
           !.admittedDefault = IF state.persistent THEN ModelDefaults(expected, @) ELSE @]

QueueNext ==
  \/ \E item \in QueueChoices :
     \/ /\ Len(state.queue) < 2 /\ ConfigureQueue(Append(state.queue, item), item)
     \/ /\ Len(state.queue) > 0 /\ ConfigureQueue(<<item>> \o Tail(state.queue), item)
  \/ /\ Len(state.queue) = 2
     /\ state' = [state EXCEPT !.queue = <<@[2], @[1]>>]
  \/ /\ Len(state.queue) > 0 /\ state' = [state EXCEPT !.queue = Tail(@)]
  \/ Admit
  \/ /\ state.phase = "running"
     /\ state' = [state EXCEPT !.phase = "interrupted", !.run = NoRun]
  \/ /\ state.phase = "interrupted"
     /\ state' = [state EXCEPT !.phase = "running", !.run = state.admitted]
  \/ /\ state.phase = "running"
     /\ state' = [state EXCEPT !.phase = "idle", !.run = NoRun, !.admitted = NoRun]

\* A generation stands for the execution inputs, project defaults and discovery configuration.
\* Manual selection, edits and unavailable models can invalidate an outstanding choice.
DiscoveryCurrent ==
  state.generation = state.captured /\ state.mode = "automatic" /\ state.available

DiscoveryNext ==
  \/ /\ state.mode = "automatic" /\ ~state.pending /\ state.available
     /\ state' = [state EXCEPT !.pending = TRUE, !.captured = state.generation]
  \/ /\ state.generation < 2
     /\ state' = [state EXCEPT !.generation = @ + 1]
  \/ state' = [state EXCEPT !.mode = "manual"]
  \/ state' = [state EXCEPT !.available = FALSE]
  \/ /\ state.pending /\ state' = [state EXCEPT !.pending = FALSE]
  \/ /\ state.pending /\ (~CheckDiscovery \/ DiscoveryCurrent)
     /\ state' = [state EXCEPT !.mode = "selected", !.pending = FALSE,
                              !.invalidCommit = @ \/ ~DiscoveryCurrent]

\* The in-place switch fences new starts while the existing worker retires and the
\* checkout checkpoint is prepared. Choosing from the picker alone does not stop a run.
HandoffIdle ==
  state.phase = "idle" /\ state.session = "none" /\ ~state.queued /\ ~state.overrides

HandoffNext ==
  \/ /\ ~state.pending /\ ~state.receipt /\ ~state.queued /\ ~state.overrides
     /\ \E stop \in BOOLEAN :
        /\ (state.phase = "idle" \/ stop)
        /\ state' = [state EXCEPT !.pending = TRUE, !.stop = stop]
  \/ /\ state.phase = "running"
     /\ state' = [state EXCEPT !.phase = "idle"]
  \/ /\ state.phase = "running" /\ state.pending /\ state.stop
     /\ state' = [state EXCEPT !.phase = "retiring"]
  \/ /\ state.phase = "retiring"
     /\ state' = [state EXCEPT !.phase = "idle"]
  \/ /\ state.pending /\ state.phase = "idle"
     /\ state' = [state EXCEPT !.session = "none"]
  \/ /\ state.pending /\ (~CheckRetirement \/ HandoffIdle)
     /\ state' = [state EXCEPT !.harness = "new", !.receipt = TRUE, !.pending = FALSE,
                              !.invalidCommit = @ \/ ~HandoffIdle]
  \/ /\ state.pending /\ state.phase # "retiring"
     /\ state' = [state EXCEPT !.pending = FALSE]
  \/ /\ ~state.pending /\ state.phase = "idle"
     /\ state' = [state EXCEPT !.phase = "running", !.session = state.harness]
  \/ /\ ~state.pending /\ state' = [state EXCEPT !.queued = ~@]
  \/ state' = [state EXCEPT !.overrides = ~@]
  \/ /\ state.receipt /\ UNCHANGED state

Next ==
  \/ CASE state.kind = "queue" -> QueueNext
       [] state.kind = "discovery" -> DiscoveryNext
       [] OTHER -> HandoffNext
  \/ UNCHANGED state

Spec == Init /\ [][Next]_state

ModelChangesAtAdmission ==
  IF state.kind = "queue" THEN state.defaults = state.admittedDefault ELSE TRUE

ActiveTurnKeepsAdmittedSettings ==
  IF state.kind = "queue" /\ state.phase = "running" THEN state.run = state.admitted ELSE TRUE

TurnAccessDoesNotBecomeDefault ==
  IF state.kind = "queue" THEN state.defaults.access = Default.access ELSE TRUE

DiscoveryRequiresCurrentInputs ==
  IF state.kind = "discovery" THEN ~state.invalidCommit ELSE TRUE

SwitchRequiresRetiredWorker ==
  IF state.kind = "handoff" THEN
    /\ ~state.invalidCommit
    /\ (state.harness = "new" => state.session # "old")
  ELSE TRUE
=============================================================================
