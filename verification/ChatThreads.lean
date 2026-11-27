import Lean

namespace Dovo.ChatThreads

structure Submission where
  id : Nat
  fingerprint : Nat
  deriving Lean.ToJson

abbrev Receipts := List Submission

def receiptFor : Receipts → Nat → Option Nat
  | [], _ => none
  | receipt :: rest, id =>
      if receipt.id = id then some receipt.fingerprint else receiptFor rest id

inductive Thread where
  | absent
  | open (receipts : Receipts) (queue : List Nat)
  -- Deletion clears the runtime receipts. Keep the admitted IDs here for the proof.
  | deleted (admissions : List Nat)

def Thread.admissions : Thread → List Nat
  | .absent => []
  | .open receipts _ => receipts.map Submission.id
  | .deleted admissions => admissions

inductive Event where
  | createDraft
  | start (first : Submission)
  | send (message : Submission)
  | retry (message : Submission)
  | dequeue (id : Nat)
  | delete
  | replayAcknowledgement
  | restart

/-- One thread identity with an atomic admission record and queue write. -/
inductive Step : Thread → Event → Thread → Prop where
  | createDraft : Step .absent .createDraft (.open [] [])
  | start (first : Submission) : Step .absent (.start first) (.open [first] [first.id])
  | send {receipts : Receipts} {queue : List Nat} {message : Submission}
      (fresh : receiptFor receipts message.id = none) :
      Step (.open receipts queue) (.send message)
        (.open (message :: receipts) (queue ++ [message.id]))
  | retry {receipts : Receipts} {queue : List Nat} {message : Submission}
      (sameReceipt : receiptFor receipts message.id = some message.fingerprint) :
      Step (.open receipts queue) (.retry message) (.open receipts queue)
  | dequeue {receipts : Receipts} {id : Nat} {queue : List Nat} :
      Step (.open receipts (id :: queue)) (.dequeue id) (.open receipts queue)
  | delete {receipts : Receipts} {queue : List Nat} :
      Step (.open receipts queue) .delete (.deleted (receipts.map Submission.id))
  | replayAcknowledgement {thread : Thread} : Step thread .replayAcknowledgement thread
  | restart {thread : Thread} : Step thread .restart thread

inductive Reachable : Thread → Prop where
  | initial : Reachable .absent
  | step {before after : Thread} {event : Event} :
      Reachable before → Step before event after → Reachable after

private theorem unrecordedId {receipts : Receipts} {id : Nat}
    (fresh : receiptFor receipts id = none) : id ∉ receipts.map Submission.id := by
  induction receipts with
  | nil => simp
  | cons receipt rest ih =>
      by_cases same : receipt.id = id
      · simp [receiptFor, same] at fresh
      · intro member
        rcases List.mem_cons.mp member with head | tail
        · exact same head.symm
        · exact ih (by simpa [receiptFor, same] using fresh) tail

theorem Step.keepsAdmission {before after : Thread} {event : Event} {id : Nat}
    (transition : Step before event after) (admitted : id ∈ before.admissions) :
    id ∈ after.admissions := by
  cases transition with
  | createDraft | start => simp [Thread.admissions] at admitted
  | send => exact List.mem_cons_of_mem _ admitted
  | retry | dequeue | delete | replayAcknowledgement | restart => exact admitted

theorem eachMessageAdmittedAtMostOnce {thread : Thread} (reachable : Reachable thread) :
    thread.admissions.Nodup := by
  induction reachable with
  | initial => simp [Thread.admissions]
  | step _ transition ih =>
      cases transition with
      | createDraft | start => simp [Thread.admissions]
      | send fresh => exact List.nodup_cons.mpr ⟨unrecordedId fresh, ih⟩
      | retry | dequeue | delete | replayAcknowledgement | restart => exact ih

theorem recordedMessageCannotBeAdmittedAgain {receipts : Receipts} {queue : List Nat}
    {next : Thread} {message : Submission} {saved : Nat}
    (recorded : receiptFor receipts message.id = some saved) :
    ¬ Step (.open receipts queue) (.send message) next := by
  intro transition
  cases transition with
  | send fresh =>
      rw [recorded] at fresh
      cases fresh

theorem changedMessageCannotReplay {receipts : Receipts} {queue : List Nat}
    {next : Thread} {message : Submission} {saved : Nat}
    (recorded : receiptFor receipts message.id = some saved)
    (changed : saved ≠ message.fingerprint) :
    ¬ Step (.open receipts queue) (.retry message) next := by
  intro transition
  cases transition with
  | retry sameReceipt => exact changed (Option.some.inj (recorded.symm.trans sameReceipt))

theorem messageRetryPreservesThread {before after : Thread} {message : Submission}
    (transition : Step before (.retry message) after) : after = before := by
  cases transition
  rfl

theorem dequeuePreservesReceipts {receipts : Receipts} {id : Nat} {queue : List Nat}
    {after : Thread} (transition : Step (.open receipts (id :: queue)) (.dequeue id) after) :
    after = .open receipts queue := by
  cases transition
  rfl

theorem deletedThreadStaysDeleted {ids : List Nat} {event : Event} {after : Thread}
    (transition : Step (.deleted ids) event after) : after = .deleted ids := by
  cases transition <;> rfl

theorem existingThreadCannotBeRecreated {receipts : Receipts} {queue : List Nat}
    {first : Submission} {next : Thread} : ¬ Step (.open receipts queue) (.start first) next := by
  intro transition
  cases transition

theorem restartPreservesThread {before after : Thread}
    (transition : Step before .restart after) : after = before := by
  cases transition
  rfl

private inductive QueueChange where
  | keep | edit | remove | move
  deriving Lean.ToJson

private inductive RestartPoint where
  | beforeChange | afterChange | afterMatchingRetry | afterConflictingRetry
  deriving Lean.ToJson

private def changeQueue (change : QueueChange) (queue : List Submission) : List Submission :=
  match change with
  | .keep => queue
  | .edit => queue.map fun entry => if entry.id = 1 then { entry with fingerprint := 2 } else entry
  | .remove => queue.filter fun entry => entry.id != 1
  | .move => (queue.filter fun entry => entry.id != 1) ++ (queue.filter fun entry => entry.id == 1)

private def retryStatus (receipts : Receipts) (message : Submission) : Nat :=
  if receiptFor receipts message.id = some message.fingerprint then 200 else 409

private def queueCase (reverse : Bool) (change : QueueChange) (restart : RestartPoint) :
    Lean.Json :=
  let original : Submission := ⟨1, 1⟩
  let other : Submission := ⟨2, 1⟩
  let changed : Submission := { original with fingerprint := 2 }
  let submissions := if reverse then [other, original] else [original, other]
  -- A queue edit changes pending input. Retrying a send checks its original receipt.
  Lean.Json.mkObj [
    ("submissions", Lean.toJson submissions),
    ("change", Lean.toJson change),
    ("restart", Lean.toJson restart),
    ("queue", Lean.toJson (changeQueue change submissions)),
    ("matchingRetry", Lean.toJson (retryStatus submissions original)),
    ("conflictingRetry", Lean.toJson (retryStatus submissions changed)),
    ("otherRetry", Lean.toJson (retryStatus submissions other))]

def renderCases : String :=
  let changes := [QueueChange.keep, .edit, .remove, .move]
  let restarts := [RestartPoint.beforeChange, .afterChange, .afterMatchingRetry, .afterConflictingRetry]
  let cases := [false, true].flatMap fun reverse => changes.flatMap fun change =>
    restarts.map fun restart => (queueCase reverse change restart).compress
  String.intercalate "\n" cases

end Dovo.ChatThreads

def main : IO Unit := IO.println Dovo.ChatThreads.renderCases
