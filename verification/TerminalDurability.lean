import Std

namespace Dovo.TerminalDurability

namespace Launch

inductive Phase where
  | fresh
  | awaitingReply
  | attachOnly
  | attached
  | unavailable
  deriving DecidableEq

structure State where
  phase : Phase
  processId : Option Nat
  -- Proof count for one launch attempt.
  createRequests : Nat

def initial : State := ⟨.fresh, none, 0⟩

inductive Event where
  | create (processId : Option Nat)
  | acceptReply (processId : Nat)
  | disconnect
  | attach (processId : Nat)
  | loseHolder
  | reportMissing

/-- The create request may reach the holder even when its reply is lost. -/
inductive Step : State → Event → State → Prop where
  | create {state : State} (fresh : state.phase = .fresh) (processId : Option Nat) :
      Step state (.create processId)
        { phase := .awaitingReply, processId, createRequests := state.createRequests + 1 }
  | acceptReply {state : State} {pid : Nat} (awaiting : state.phase = .awaitingReply)
      (held : state.processId = some pid) :
      Step state (.acceptReply pid) { state with phase := .attached }
  | disconnect {state : State} (wasConnected : state.phase = .awaitingReply ∨ state.phase = .attached) :
      Step state .disconnect { state with phase := .attachOnly }
  | attach {state : State} {pid : Nat} (recovering : state.phase = .attachOnly)
      (held : state.processId = some pid) :
      Step state (.attach pid) { state with phase := .attached }
  | loseHolder {state : State} : Step state .loseHolder { state with processId := none }
  | reportMissing {state : State} (recovering : state.phase = .attachOnly)
      (missing : state.processId = none) :
      Step state .reportMissing { state with phase := .unavailable }

inductive Reachable : State → Prop where
  | initial : Reachable initial
  | step {before after : State} {event : Event} :
      Reachable before → Step before event after → Reachable after

theorem createAtMostOnce {state : State} (reachable : Reachable state) :
    state.createRequests ≤ 1 ∧ (state.phase = .fresh → state.createRequests = 0) := by
  induction reachable with
  | initial => simp [Launch.initial]
  | step _ transition ih =>
      cases transition with
      | create fresh =>
          exact ⟨by simp [ih.2 fresh], by simp⟩
      | acceptReply | disconnect | attach | reportMissing =>
          exact ⟨ih.1, by simp⟩
      | loseHolder => exact ih

theorem lostCreateReplyAllowsNoSecondCreate {state next : State} {pid : Option Nat}
    (recovering : state.phase = .attachOnly) : ¬ Step state (.create pid) next := by
  intro transition
  cases transition with
  | create fresh => cases recovering.symm.trans fresh

theorem attachPreservesProcess {state next : State} {pid : Nat}
    (transition : Step state (.attach pid) next) :
    state.processId = some pid ∧ next.processId = some pid := by
  cases transition with
  | attach _ held => exact ⟨held, held⟩

theorem missingHolderCannotBeAttached {state next : State} {pid : Nat}
    (missing : state.processId = none) : ¬ Step state (.attach pid) next := by
  intro transition
  cases transition with
  | attach _ held => cases missing.symm.trans held

end Launch

namespace TrackedInput

inductive Phase where
  | ready
  | awaitingReply
  | confirmed
  | uncertain
  deriving DecidableEq

structure State where
  phase : Phase
  -- Dispatch attempts for this invocation. PTY execution is outside the model.
  dispatches : Nat

def initial : State := ⟨.ready, 0⟩

inductive Event where
  | dispatch
  | acknowledge
  | loseReply
  | reconnect

inductive Step : State → Event → State → Prop where
  | dispatch {state : State} (ready : state.phase = .ready) :
      Step state .dispatch ⟨.awaitingReply, state.dispatches + 1⟩
  | acknowledge {state : State} (awaiting : state.phase = .awaitingReply) :
      Step state .acknowledge { state with phase := .confirmed }
  | loseReply {state : State} (awaiting : state.phase = .awaitingReply) :
      Step state .loseReply { state with phase := .uncertain }
  | reconnect {state : State} : Step state .reconnect state

inductive Reachable : State → Prop where
  | initial : Reachable initial
  | step {before after : State} {event : Event} :
      Reachable before → Step before event after → Reachable after

theorem dispatchAtMostOnce {state : State} (reachable : Reachable state) :
    state.dispatches ≤ 1 ∧ (state.phase = .ready → state.dispatches = 0) := by
  induction reachable with
  | initial => simp [TrackedInput.initial]
  | step _ transition ih =>
      cases transition with
      | dispatch ready => exact ⟨by simp [ih.2 ready], by simp⟩
      | acknowledge | loseReply => exact ⟨ih.1, by simp⟩
      | reconnect => exact ih

theorem uncertainInputStaysUncertain {state next : State} {event : Event}
    (uncertain : state.phase = .uncertain) (transition : Step state event next) :
    next = state := by
  cases transition with
  | dispatch ready => cases uncertain.symm.trans ready
  | acknowledge awaiting | loseReply awaiting => cases uncertain.symm.trans awaiting
  | reconnect => rfl

end TrackedInput

namespace OutputReplay

/-- The absolute start offset of the holder's raw replay response. -/
def replayOffset (start finish : Nat) (requested : Option Nat) : Nat :=
  match requested with
  | none => start
  | some cursor => if cursor > finish then start else max start cursor

theorem retainedCursorResumesExactly {start finish cursor : Nat}
    (retained : start ≤ cursor) (reported : cursor ≤ finish) :
    replayOffset start finish (some cursor) = cursor := by
  simp [replayOffset, Nat.not_lt_of_ge reported, Nat.max_eq_right retained]

theorem expiredCursorReturnsRetainedOutput {start finish cursor : Nat}
    (expired : cursor < start) (validWindow : start ≤ finish) :
    replayOffset start finish (some cursor) = start := by
  have reported := Nat.le_trans (Nat.le_of_lt expired) validWindow
  simp [replayOffset, Nat.not_lt_of_ge reported, Nat.max_eq_left (Nat.le_of_lt expired)]

theorem futureCursorReturnsRetainedOutput {start finish cursor : Nat} (future : finish < cursor) :
    replayOffset start finish (some cursor) = start := by
  simp [replayOffset, future]

theorem replayLengthWithinLimit {start finish limit : Nat} {requested : Option Nat}
    (bounded : finish - start ≤ limit) : finish - replayOffset start finish requested ≤ limit := by
  have lower : start ≤ replayOffset start finish requested := by
    cases requested with
    | none => exact Nat.le_refl _
    | some cursor =>
        by_cases future : finish < cursor
        · simp [replayOffset, future]
        · simpa [replayOffset, future] using Nat.le_max_left start cursor
  omega

theorem consecutiveReplaysMeetAtTheSavedCursor {start cursor nextStart finish nextFinish : Nat}
    (retained : start ≤ cursor) (firstRead : cursor ≤ finish)
    (stillRetained : nextStart ≤ finish) (outputGrew : finish ≤ nextFinish) :
    replayOffset nextStart nextFinish (some finish) = finish ∧
      (finish - replayOffset start finish (some cursor)) +
        (nextFinish - replayOffset nextStart nextFinish (some finish)) = nextFinish - cursor := by
  rw [retainedCursorResumesExactly retained firstRead,
    retainedCursorResumesExactly stillRetained outputGrew]
  exact ⟨rfl, by omega⟩

end OutputReplay

end Dovo.TerminalDurability
