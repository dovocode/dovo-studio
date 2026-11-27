import Lean

namespace Dovo.ThreadHandoff

inductive Source where
  | owned
  | blocked
  | moved
  deriving DecidableEq

inductive Destination where
  | absent
  | staged
  | active
  | discarded
  deriving DecidableEq

structure Ownership where
  source : Source
  destination : Destination

inductive Event where
  | blockSource
  | stageDestination
  | recordMove
  | activateDestination
  | discardDestination
  | cancelConfirmedAbsent
  | cancelWhileOffline
  | returnAfterDiscard
  | loseReply
  | replayActivation
  | restoreSameRuntimeBackup

/-- Durable decisions for one transfer ID. A same-runtime restore preserves those decisions. -/
inductive Step : Ownership → Event → Ownership → Prop where
  | blockSource : Step ⟨.owned, .absent⟩ .blockSource ⟨.blocked, .absent⟩
  | stageDestination : Step ⟨.blocked, .absent⟩ .stageDestination ⟨.blocked, .staged⟩
  | recordMove : Step ⟨.blocked, .staged⟩ .recordMove ⟨.moved, .staged⟩
  | activateDestination :
      Step ⟨.moved, .staged⟩ .activateDestination ⟨.moved, .active⟩
  | discardDestination {source : Source} :
      Step ⟨source, .staged⟩ .discardDestination ⟨source, .discarded⟩
  | cancelConfirmedAbsent :
      Step ⟨.blocked, .absent⟩ .cancelConfirmedAbsent ⟨.owned, .absent⟩
  | cancelWhileOffline {state : Ownership} : Step state .cancelWhileOffline state
  | returnAfterDiscard {source : Source} :
      Step ⟨source, .discarded⟩ .returnAfterDiscard ⟨.owned, .discarded⟩
  | loseReply {state : Ownership} : Step state .loseReply state
  | replayActivation : Step ⟨.moved, .active⟩ .replayActivation ⟨.moved, .active⟩
  | restoreSameRuntimeBackup {state : Ownership} :
      Step state .restoreSameRuntimeBackup state

inductive Reachable : Ownership → Prop where
  | initial : Reachable ⟨.owned, .absent⟩
  | step {before after : Ownership} {event : Event} :
      Reachable before → Step before event after → Reachable after

theorem activeDestinationRequiresMovedSource {state : Ownership}
    (reachable : Reachable state) (active : state.destination = .active) :
    state.source = .moved := by
  induction reachable with
  | initial => cases active
  | step _ transition ih =>
    cases transition with
    | activateDestination | replayActivation => rfl
    | loseReply | cancelWhileOffline | restoreSameRuntimeBackup => exact ih active
    | _ => cases active

-- A backup can omit either thread. A present copy still needs durable ownership to execute.
def sourceExecutable (state : Ownership) (threadPresent : Bool) : Prop :=
  threadPresent = true ∧ state.source = .owned

def destinationExecutable (state : Ownership) (threadPresent : Bool) : Prop :=
  threadPresent = true ∧ state.destination = .active

theorem onlyOneCopyCanExecute {state : Ownership} {sourcePresent destinationPresent : Bool}
    (reachable : Reachable state) :
    ¬ (sourceExecutable state sourcePresent ∧ destinationExecutable state destinationPresent) := by
  intro ⟨source, destination⟩
  have moved := activeDestinationRequiresMovedSource reachable destination.2
  exact Source.noConfusion (source.2.symm.trans moved)

theorem discardedReceiptSurvives {before after : Ownership} {event : Event}
    (transition : Step before event after) (discarded : before.destination = .discarded) :
    after.destination = .discarded := by
  cases transition with
  | returnAfterDiscard => rfl
  | loseReply | cancelWhileOffline | restoreSameRuntimeBackup => exact discarded
  | _ => cases discarded

namespace BackupRestore

inductive SourceProjection where
  | owned
  | blocked
  | moved (transfer : Nat)
  deriving DecidableEq, Lean.ToJson

/-- After the current fence rows replace the backup's rows, reconcile its task metadata. -/
def restoreSource (currentFence : Option Nat) (backup : Option SourceProjection) :
    Option SourceProjection :=
  backup.map fun projection =>
    match currentFence, projection with
    | some transfer, _ => .moved transfer
    | none, .moved _ => .owned
    | none, projection => projection

theorem currentFenceOverridesAnyPresentBackup {current : Nat} (backup : SourceProjection) :
    restoreSource (some current) (some backup) = some (.moved current) := by
  cases backup <;> rfl

theorem returnedOwnershipOverridesOlderMove (old : Nat) :
    restoreSource none (some (.moved old)) = some .owned := rfl

theorem activeDestinationKeepsRestoredSourceReadOnly {state : Ownership}
    (reachable : Reachable state) (active : state.destination = .active)
    (transfer : Nat) (backup : Option SourceProjection) :
    restoreSource (if state.source = .moved then some transfer else none) backup ≠ some .owned := by
  rw [if_pos (activeDestinationRequiresMovedSource reachable active)]
  cases backup with
  | none => simp [restoreSource]
  | some projection => simp [currentFenceOverridesAnyPresentBackup projection]

inductive Receipt where
  | staged (task : Nat)
  | activated (task : Nat)
  | discarded
  deriving DecidableEq, Lean.ToJson

inductive DestinationProjection where
  | staged (transfer : Nat) (task : Nat)
  | active (task : Nat)
  deriving DecidableEq, Lean.ToJson

/-- The two input rows are looked up by the same transfer ID. -/
def mergeReceipt (current backup : Option Receipt) : Option Receipt :=
  match current with
  | some .discarded => some .discarded
  | some (.activated task) => backup.map fun _ => .activated task
  | _ => backup

def restoreDestination (transfer : Nat) (current backupReceipt : Option Receipt)
    (backupTask : Option DestinationProjection) : Option DestinationProjection :=
  backupTask.map fun projection =>
    match mergeReceipt current backupReceipt, projection with
    | some (.activated task), .staged savedTransfer savedTask =>
        if task = savedTask ∧ transfer = savedTransfer then .active task else projection
    | _, _ => projection

theorem missingBackupTaskCannotBeRecreated (transfer : Nat)
    (current backupReceipt : Option Receipt) :
    restoreDestination transfer current backupReceipt none = none := rfl

theorem noBackupReceiptKeepsRestoredTaskStaged (transfer task : Nat) :
    restoreDestination transfer (some (.activated task)) none (some (.staged transfer task)) =
      some (.staged transfer task) := rfl

theorem matchingActivationRestoresExecution (transfer task : Nat) (backupReceipt : Receipt) :
    restoreDestination transfer (some (.activated task)) (some backupReceipt)
      (some (.staged transfer task)) = some (.active task) := by
  simp [restoreDestination, mergeReceipt]

theorem mismatchedReceiptCannotActivate {transfer task savedTransfer savedTask : Nat}
    (backupReceipt : Receipt) (unmatched : task ≠ savedTask ∨ transfer ≠ savedTransfer) :
    restoreDestination transfer (some (.activated task)) (some backupReceipt)
      (some (.staged savedTransfer savedTask)) = some (.staged savedTransfer savedTask) := by
  rcases unmatched with differentTask | differentTransfer
  · simp [restoreDestination, mergeReceipt, differentTask]
  · simp [restoreDestination, mergeReceipt, differentTransfer]

theorem discardOverridesBackupReceipt (transfer task : Nat) (backupReceipt : Option Receipt) :
    mergeReceipt (some .discarded) backupReceipt = some .discarded ∧
    restoreDestination transfer (some .discarded) backupReceipt (some (.staged transfer task)) =
      some (.staged transfer task) :=
  ⟨rfl, rfl⟩

private structure SourceCase where
  name : String
  currentFence : Option Nat
  backup : Option SourceProjection
  deriving Lean.ToJson

private def sourceCases : List SourceCase := [
  ⟨"current fence keeps the same move", some 1, some (.moved 1)⟩,
  ⟨"newer fence replaces an older move", some 2, some (.moved 1)⟩,
  ⟨"fence blocks a backup made before the move", some 1, some .owned⟩,
  ⟨"fence replaces a preparing move", some 1, some .blocked⟩,
  ⟨"returned ownership clears the backup move", none, some (.moved 1)⟩,
  ⟨"no fence leaves a preparing move blocked", none, some .blocked⟩,
  ⟨"no fence keeps an owned thread", none, some .owned⟩,
  ⟨"fence survives a backup without the thread", some 1, none⟩
]

private structure DestinationCase where
  name : String
  transfer : Nat := 1
  current : Option Receipt
  backupReceipt : Option Receipt
  backupTask : Option DestinationProjection := some (.staged 1 1)
  deriving Lean.ToJson

private def destinationCases : List DestinationCase := [
  { name := "matching activation releases a staged thread"
    current := some (.activated 1), backupReceipt := some (.staged 1) },
  { name := "receipt for a different transfer keeps the thread staged", transfer := 2
    current := some (.activated 1), backupReceipt := some (.staged 1) },
  { name := "receipt for a different task keeps the thread staged"
    current := some (.activated 2), backupReceipt := some (.staged 1) },
  { name := "activation without a backup receipt keeps the thread staged"
    current := some (.activated 1), backupReceipt := none },
  { name := "activation cannot recreate a missing backup thread"
    current := some (.activated 1), backupReceipt := some (.staged 1), backupTask := none },
  { name := "discard replaces the backup receipt and keeps the thread staged"
    current := some .discarded, backupReceipt := some (.staged 1) },
  { name := "discard is carried even without a backup receipt"
    current := some .discarded, backupReceipt := none },
  { name := "no current receipt keeps the backup decision"
    current := none, backupReceipt := some (.activated 1) },
  { name := "a current staged receipt leaves a backup activation in force"
    current := some (.staged 1), backupReceipt := some (.activated 1) }
]

def renderCases : String :=
  let source := sourceCases.map fun input => Lean.Json.mkObj [
    ("source", Lean.toJson input),
    ("restored", Lean.toJson (restoreSource input.currentFence input.backup))]
  let destination := destinationCases.map fun input => Lean.Json.mkObj [
    ("destination", Lean.toJson input),
    ("receipt", Lean.toJson (mergeReceipt input.current input.backupReceipt)),
    ("restored", Lean.toJson
      (restoreDestination input.transfer input.current input.backupReceipt input.backupTask))]
  String.intercalate "\n" ((source ++ destination).map Lean.Json.compress)

end BackupRestore

end Dovo.ThreadHandoff

def main : IO Unit := IO.println Dovo.ThreadHandoff.BackupRestore.renderCases
