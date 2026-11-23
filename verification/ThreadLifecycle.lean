import Std

namespace Dovo.ThreadLifecycle

structure Address where
  runtime : Nat
  thread : Nat
  deriving DecidableEq

inductive Outcome where
  | completed
  | failed
  | cancelled
  deriving DecidableEq

structure Turn where
  attempt : Nat
  input : Nat
  output : List Nat
  needsCheckpoint : Bool

structure Result where
  turn : Turn
  outcome : Outcome

inductive Phase where
  | idle
  | running (turn : Turn)
  | saving (result : Result)
  | interrupted (turn : Turn)

structure Thread where
  phase : Phase := .idle
  queue : List Nat := []
  paused : Bool := false
  nextAttempt : Nat := 0
  results : List Result := []

inductive Event where
  | enqueue (input : Nat)
  | pauseQueue
  | resumeQueue
  | startNext (needsCheckpoint : Bool)
  | providerOutput (attempt chunk : Nat)
  | providerFinished (attempt : Nat) (outcome : Outcome)
  | saveResult (attempt : Nat) (storageReady checkpointReady : Bool)
  | restart
  | resumeInterrupted

def beginTurn (state : Thread) (input : Nat) (needsCheckpoint : Bool) : Thread :=
  { state with
    phase := .running ⟨state.nextAttempt, input, [], needsCheckpoint⟩
    nextAttempt := state.nextAttempt + 1 }

/-- One stored thread. Queue admission and the provider journal have their own models. -/
def apply (state : Thread) (event : Event) : Thread :=
  match event with
  | .enqueue input => { state with queue := state.queue ++ [input] }
  | .pauseQueue => { state with paused := true }
  | .resumeQueue => { state with paused := false }
  | .startNext capture =>
      if state.paused then state else
      match state.phase, state.queue with
      | .idle, input :: rest => beginTurn { state with queue := rest } input capture
      | _, _ => state
  | .providerOutput attempt chunk =>
      match state.phase with
      | .running turn =>
          if turn.attempt = attempt then
            { state with phase := .running { turn with output := turn.output ++ [chunk] } }
          else state
      | _ => state
  | .providerFinished attempt outcome =>
      match state.phase with
      | .running turn =>
          if turn.attempt = attempt then
            let result := ⟨turn, outcome⟩
            { state with phase := .saving result, results := result :: state.results }
          else state
      | _ => state
  | .saveResult attempt storageReady checkpointReady =>
      match state.phase with
      | .saving result =>
          if result.turn.attempt = attempt then
            if storageReady && (!result.turn.needsCheckpoint || checkpointReady) then
              { state with phase := .idle }
            else { state with paused := true }
          else state
      | _ => state
  | .restart =>
      match state.phase with
      | .running turn => { state with phase := .interrupted turn, paused := true }
      | _ => { state with paused := true }
  | .resumeInterrupted =>
      match state.phase with
      | .interrupted turn => beginTurn state turn.input turn.needsCheckpoint
      | _ => state

def deliver (thread destination : Address) (state : Thread) (event : Event) : Thread :=
  if thread = destination then apply state event else state

def blocksHandoff (state : Thread) : Bool :=
  match state.phase with
  | .running _ | .saving _ => true
  | _ => false

theorem wrongRuntimeOrThreadIsUntouched {thread destination : Address} (state : Thread)
    (event : Event) (wrong : thread.runtime ≠ destination.runtime ∨ thread.thread ≠ destination.thread) :
    deliver thread destination state event = state := by
  have different : thread ≠ destination := by
    intro equal
    subst destination
    simp at wrong
  simp [deliver, different]

theorem retiredTurnCannotWriteToNext {state : Thread} {turn : Turn} {attempt : Nat}
    (running : state.phase = .running turn) (retired : turn.attempt ≠ attempt)
    (chunk : Nat) (outcome : Outcome) :
    apply state (.providerOutput attempt chunk) = state ∧
      apply state (.providerFinished attempt outcome) = state := by
  simp [apply, running, retired]

theorem providerCompletionBindsReplyAndOutcome {state : Thread} {turn : Turn}
    (running : state.phase = .running turn) (outcome : Outcome) :
    apply state (.providerFinished turn.attempt outcome) =
      { state with phase := .saving ⟨turn, outcome⟩, results := ⟨turn, outcome⟩ :: state.results } := by
  simp [apply, running]

theorem noCallbackCanChangeARecordedResult {state : Thread} {result : Result} {attempt chunk : Nat}
    (saving : state.phase = .saving result) (outcome : Outcome) :
    apply state (.providerOutput attempt chunk) = state ∧
      apply state (.providerFinished attempt outcome) = state := by
  simp [apply, saving]

theorem noNewTurnUntilResultIsSaved {state : Thread} {result : Result}
    (saving : state.phase = .saving result) (capture : Bool) :
    apply state (.startNext capture) = state := by
  simp [apply, saving]

theorem pendingSaveBlocksHandoffEvenAfterRestart {state : Thread} {result : Result}
    (saving : state.phase = .saving result) :
    blocksHandoff state = true ∧ blocksHandoff (apply state .restart) = true := by
  simp [blocksHandoff, apply, saving]

theorem retrySaveOnlyPreservesQueueAndHistory {state : Thread} (attempt : Nat)
    (storageReady checkpointReady : Bool) :
    let next := apply state (.saveResult attempt storageReady checkpointReady)
    next.queue = state.queue ∧ next.results = state.results ∧ next.nextAttempt = state.nextAttempt := by
  cases phase : state.phase <;> simp [apply, phase]
  split <;> try simp_all
  split <;> simp_all

theorem failedSaveOrRestartHoldsTheSameResult {state : Thread} {result : Result}
    (saving : state.phase = .saving result) (checkpointReady : Bool) :
    apply state (.saveResult result.turn.attempt false checkpointReady) =
      { state with paused := true } ∧
    apply state .restart = { state with paused := true } := by
  simp [apply, saving]

theorem checkpointFreeTurnCanSettle {state : Thread} {result : Result}
    (saving : state.phase = .saving result) (noCheckpoint : result.turn.needsCheckpoint = false) :
    apply state (.saveResult result.turn.attempt true false) = { state with phase := .idle } := by
  simp [apply, saving, noCheckpoint]

theorem readyFinalizationSettlesEveryOutcome {state : Thread} {turn : Turn}
    (running : state.phase = .running turn) (outcome : Outcome) :
    apply (apply state (.providerFinished turn.attempt outcome))
      (.saveResult turn.attempt true true) =
        { state with phase := .idle, results := ⟨turn, outcome⟩ :: state.results } := by
  simp [apply, running]

theorem duplicateSaveAfterSettlingIsInert {state : Thread} (settled : state.phase = .idle)
    (attempt : Nat) (storageReady checkpointReady : Bool) :
    apply state (.saveResult attempt storageReady checkpointReady) = state := by
  simp [apply, settled]

theorem interruptedTurnResumesItsOwnInput {state : Thread} {turn : Turn}
    (running : state.phase = .running turn) :
    apply (apply state .restart) .resumeInterrupted =
      beginTurn { state with paused := true } turn.input turn.needsCheckpoint := by
  simp [apply, running, beginTurn]

theorem finishingSaveDoesNotRunPausedFollowUp {state : Thread}
    (paused : state.paused = true) (attempt : Nat) (checkpointReady capture : Bool) :
    let saved := apply state (.saveResult attempt true checkpointReady)
    apply saved (.startNext capture) = saved := by
  have stillPaused : (apply state (.saveResult attempt true checkpointReady)).paused = true := by
    cases phase : state.phase <;> simp [apply, phase, paused]
    split <;> try simp_all
    split <;> simp_all
  change (if (apply state (.saveResult attempt true checkpointReady)).paused then _ else _) = _
  simp only [stillPaused, if_true, Bool.true_eq]

theorem nextTurnTakesQueuedInputInOrder {state : Thread} {input : Nat} {rest : List Nat}
    (idle : state.phase = .idle) (queue : state.queue = input :: rest)
    (unpaused : state.paused = false) (capture : Bool) :
    apply state (.startNext capture) = beginTurn { state with queue := rest } input capture := by
  simp [apply, idle, queue, unpaused]

theorem recordedResultsSurviveEveryStep (state : Thread) (event : Event) (result : Result)
    (recorded : result ∈ state.results) :
    result ∈ (apply state event).results := by
  cases event <;> simp [apply, beginTurn, recorded]
  all_goals
    split <;> try simp_all [beginTurn]
  all_goals
    split <;> try simp_all [beginTurn]
  all_goals
    split <;> simp_all [beginTurn]

end Dovo.ThreadLifecycle
