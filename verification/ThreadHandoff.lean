import Std

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
  deriving DecidableEq

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
  deriving DecidableEq

inductive DestinationProjection where
  | staged (transfer : Nat) (task : Nat)
  | active (task : Nat)
  deriving DecidableEq

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

end BackupRestore

end Dovo.ThreadHandoff
