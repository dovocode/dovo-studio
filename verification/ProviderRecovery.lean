import Lean

namespace Dovo.ProviderRecovery

inductive Kind where
  | start | steer | interrupt | checkpoint | answer
  deriving DecidableEq, Lean.ToJson

inductive Status where
  | pending | dispatched | acknowledged | completed | uncertain
  deriving DecidableEq, Lean.ToJson

structure Action where
  task : Nat
  attempt : Nat
  kind : Kind
  status : Status
  deriving DecidableEq, Lean.ToJson

def recoverStatus (kind : Kind) (status : Status) : Status :=
  if status = .dispatched ∧ kind ≠ .checkpoint then .uncertain else status

def recoverAction (action : Action) : Action :=
  { action with status := recoverStatus action.kind action.status }

def inScope (task : Nat) (attempt : Option Nat) (action : Action) : Bool :=
  (task == action.task) && attempt.all (· == action.attempt)

def hasUncertain (task : Nat) (attempt : Option Nat) (actions : List Action) : Bool :=
  actions.any fun action => inScope task attempt action && decide (action.status = .uncertain)

/-- Running turns interrupted before finalization. This bit records eligibility for automatic
recovery; provider availability and user and project preferences are checked later. -/
def automatic (preparingQueuedWork paused uncertain : Bool) : Bool :=
  !preparingQueuedWork && !paused && !uncertain

theorem recoveryIdempotent (kind : Kind) (status : Status) :
    recoverStatus kind (recoverStatus kind status) = recoverStatus kind status := by
  cases kind <;> cases status <;> decide

theorem localCheckpointStillRepeatable (status : Status) :
    recoverStatus .checkpoint status = status := by
  simp [recoverStatus]

theorem dispatchLeavesUncertainty (action : Action) (remote : action.kind ≠ .checkpoint)
    (dispatched : action.status = .dispatched) :
    (recoverAction action).status = .uncertain := by
  simp [recoverAction, recoverStatus, dispatched, remote]

theorem uncertainActionBlocksAutoRecovery {actions : List Action} {action : Action}
    {task : Nat} {attempt : Option Nat} (recorded : action ∈ actions)
    (scope : inScope task attempt action = true)
    (uncertain : (recoverAction action).status = .uncertain)
    (preparingQueuedWork paused : Bool) :
    automatic preparingQueuedWork paused
      (hasUncertain task attempt (actions.map recoverAction)) = false := by
  have found : hasUncertain task attempt (actions.map recoverAction) = true := by
    apply List.any_eq_true.mpr
    exact ⟨recoverAction action, List.mem_map.mpr ⟨action, recorded, rfl⟩,
      by simpa [inScope, recoverAction] using And.intro scope uncertain⟩
  simp [automatic, found]

theorem oldAttemptDoesNotEnterScope {action : Action} {task attempt : Nat}
    (old : action.attempt ≠ attempt) :
    inScope task (some attempt) (recoverAction action) = false := by
  simp [inScope, recoverAction, beq_eq_false_iff_ne.mpr (Ne.symm old)]

theorem otherThreadDoesNotEnterScope {action : Action} {task : Nat}
    (different : task ≠ action.task) (attempt : Option Nat) :
    inScope task attempt (recoverAction action) = false := by
  simp [inScope, recoverAction, beq_eq_false_iff_ne.mpr different]

theorem legacyUnscopedAttemptChecksEveryActionForTheTask (action : Action) :
    inScope action.task none (recoverAction action) = true := by
  simp [inScope, recoverAction]

structure Input where
  name : String
  actions : List Action
  activeAttempt : Option Nat
  preparingQueuedWork : Bool := false
  paused : Bool := false
  deriving Lean.ToJson

def Input.result (input : Input) : Lean.Json :=
  let recovered := input.actions.map recoverAction
  Lean.Json.mkObj [
    ("input", Lean.toJson input),
    ("recovered", Lean.toJson recovered),
    ("automatic", Lean.toJson
      (automatic input.preparingQueuedWork input.paused
        (hasUncertain 0 input.activeAttempt recovered)))]

private def kinds : List Kind := [.start, .steer, .interrupt, .checkpoint, .answer]
private def statuses : List Status := [.pending, .dispatched, .acknowledged, .completed, .uncertain]

theorem casesCoverEveryKind (kind : Kind) : kind ∈ kinds := by
  cases kind <;> decide

theorem casesCoverEveryStatus (status : Status) : status ∈ statuses := by
  cases status <;> decide

private def cases : List Input :=
  (kinds.flatMap fun kind => statuses.map fun status =>
    { name := (Lean.toJson kind).getStr?.toOption.getD "" ++ "/" ++
        (Lean.toJson status).getStr?.toOption.getD ""
      actions := [⟨0, 1, kind, status⟩], activeAttempt := some 1 }) ++ [
    ⟨"previous attempt", [⟨0, 0, .steer, .dispatched⟩, ⟨0, 1, .start, .acknowledged⟩],
      some 1, false, false⟩,
    ⟨"legacy thread without attempt ID", [⟨0, 0, .answer, .dispatched⟩], none, false, false⟩,
    ⟨"another thread", [⟨1, 1, .steer, .dispatched⟩], some 1, false, false⟩,
    ⟨"paused queue", [], some 1, false, true⟩,
    ⟨"preparing queued work", [], none, true, false⟩
  ]

def renderCases : String :=
  String.intercalate "\n" (cases.map fun input => input.result.compress)

end Dovo.ProviderRecovery

def main : IO Unit := IO.println Dovo.ProviderRecovery.renderCases
