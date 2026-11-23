import Std

namespace Dovo.OfflineCache

inductive Entry where
  | incomplete
  | complete (value : Nat)

structure Files where
  published : Option Entry
  backup : Option Nat
  temporary : Option Nat

/-- Readers use only a published file or its last committed backup. -/
def read (files : Files) : Option Nat :=
  match files.published with
  | some (.complete value) => some value
  | _ => files.backup

def stage (files : Files) (value : Nat) : Files :=
  { files with temporary := some value }

def preserve (files : Files) : Files :=
  match files.published with
  | some (.complete value) => { files with published := none, backup := some value }
  | _ => { files with published := none }

def publish (files : Files) : Files :=
  match files.published, files.temporary with
  | none, some value => { files with published := some (.complete value), temporary := none }
  | _, _ => files

def clearBackup (files : Files) : Files :=
  { files with backup := none }

theorem interruptedReplacementKeepsLastPublishedValue (files : Files) (incoming : Nat) :
    read (stage files incoming) = read files ∧
    read (preserve (stage files incoming)) = read files := by
  cases files with
  | mk published backup temporary =>
      cases published with
      | none => exact ⟨rfl, rfl⟩
      | some entry => cases entry <;> exact ⟨rfl, rfl⟩

theorem clearingOldBackupBeforePreserveKeepsPrimary {files : Files} {value : Nat}
    (primary : files.published = some (.complete value)) :
    read (clearBackup files) = some value := by
  simp [read, clearBackup, primary]

theorem partialReplacementFallsBackToLastPublishedValue (files : Files) (incoming : Nat) :
    read { preserve (stage files incoming) with published := some .incomplete } = read files := by
  cases files with
  | mk published backup temporary =>
      cases published with
      | none => rfl
      | some entry => cases entry <;> rfl

theorem successfulReplacementPublishesNewValue (files : Files) (incoming : Nat) :
    read (clearBackup (publish (preserve (stage files incoming)))) = some incoming := by
  cases files with
  | mk published backup temporary =>
      cases published with
      | none => rfl
      | some entry => cases entry <;> rfl

theorem publishedFileWinsAfterCrashBeforeCleanup (files : Files) (incoming : Nat) :
    read (publish (preserve (stage files incoming))) = some incoming := by
  cases files with
  | mk published backup temporary =>
      cases published with
      | none => rfl
      | some entry => cases entry <;> rfl

theorem deletingBackupBeforePublishedFileCannotResurrectIt (files : Files) :
    read { clearBackup files with published := none } = none := rfl

end Dovo.OfflineCache
