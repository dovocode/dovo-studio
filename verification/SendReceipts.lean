import Lean

namespace Dovo.SendReceipts

inductive Receipt where
  | absent | full | retired
  deriving DecidableEq, Lean.ToJson

structure State where
  receipt : Receipt := .absent
  savedSend : Bool := true
  accepted : Bool := false
  cached : Bool := false
  admissions : Nat := 0

def send (state : State) (replyDelivered : Bool) : State :=
  match state.receipt with
  | .absent => { state with receipt := .full, accepted := replyDelivered, admissions := state.admissions + 1 }
  | .full => { state with accepted := replyDelivered }
  | .retired => state

def restart (state : State) : State :=
  { state with accepted := false }

def saveCache (state : State) : State :=
  { state with cached := true }

def removeJournal (state : State) (writeSucceeded : Bool) : State :=
  if state.accepted && state.cached && writeSucceeded then { state with savedSend := false }
  else state

def compact (state : State) (acknowledgeDelivered : Bool) : State :=
  if !state.savedSend && acknowledgeDelivered && state.receipt = .full then
    { state with receipt := .retired }
  else state

theorem lostReplyStillLeavesAnAdmission (state : State) (fresh : state.receipt = .absent) :
    (send state false).receipt = .full ∧ (send state false).admissions = state.admissions + 1 := by
  simp [send, fresh]

theorem replayCannotAdmitTwice (state : State) (recorded : state.receipt ≠ .absent)
    (replyDelivered : Bool) : (send state replyDelivered).admissions = state.admissions := by
  cases phase : state.receipt <;> simp_all [send]

theorem savedJournalPreventsRetirement (state : State) (saved : state.savedSend = true)
    (acknowledgeDelivered : Bool) :
    (compact state acknowledgeDelivered).receipt = state.receipt := by
  simp [compact, saved]

theorem failedJournalWriteKeepsOriginalSend (state : State) :
    removeJournal state false = state := by simp [removeJournal]

theorem uncachedReplyKeepsJournal (state : State) (uncached : state.cached = false)
    (writeSucceeded : Bool) : removeJournal state writeSucceeded = state := by
  simp [removeJournal, uncached]

structure Input where
  loseReply : Bool
  failRemoval : Bool
  loseCompaction : Bool
  deriving Lean.ToJson

def scenario (input : Input) : Lean.Json :=
  let first := send {} (!input.loseReply)
  let recovered := send (restart first) true
  let cached := saveCache recovered
  let removal := removeJournal cached (!input.failRemoval)
  let compacted := compact (removeJournal cached true) (!input.loseCompaction)
  Lean.Json.mkObj [
    ("input", Lean.toJson input),
    ("acceptedBeforeRestart", Lean.toJson first.accepted),
    ("savedAfterFirstRemoval", Lean.toJson removal.savedSend),
    ("finalReceipt", Lean.toJson compacted.receipt),
    ("admissions", Lean.toJson (send compacted true).admissions)]

def renderCases : String :=
  let flags := [false, true]
  let inputs := flags.flatMap fun reply => flags.flatMap fun removal =>
    flags.map fun compaction => { loseReply := reply, failRemoval := removal, loseCompaction := compaction }
  String.intercalate "\n" (inputs.map fun input => (scenario input).compress)

end Dovo.SendReceipts

def main : IO Unit := IO.println Dovo.SendReceipts.renderCases
