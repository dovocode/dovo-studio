namespace Dovo.ThreadStart

inductive Admission where
  | create
  | replay
  | reject
  deriving DecidableEq

inductive Bootstrap where
  | absent
  | present (fingerprint : Nat)
  | deleted

def admitStart (stored : Bootstrap) (fingerprint : Nat) : Admission :=
  match stored with
  | .absent => .create
  | .present saved => if saved = fingerprint then .replay else .reject
  | .deleted => .reject

theorem matchingStartReplays (fingerprint : Nat) :
    admitStart (.present fingerprint) fingerprint = .replay := by
  simp [admitStart]

theorem conflictingStartPreservesExistingDraft {saved requested : Nat}
    (different : saved ≠ requested) :
    admitStart (.present saved) requested = .reject := by
  simp [admitStart, different]

theorem deletedThreadCannotBeRecreated (fingerprint : Nat) :
    admitStart .deleted fingerprint = .reject := rfl

inductive Parent where
  | available
  | reserved
  | archived
  | deleted
  deriving DecidableEq

inductive Context where
  | snapshot
  | committedHead
  deriving DecidableEq

def sideContext (busy : Bool) : Context :=
  if busy then .committedHead else .snapshot

def sideMayCommit (parent : Parent) (context : Context) (busy : Bool) : Bool :=
  decide (parent = .available) && (decide (context = .committedHead) || !busy)

theorem busyParentUsesCommittedHead : sideContext true = .committedHead := rfl

theorem parentMustStillBeAvailable {parent : Parent} (unavailable : parent ≠ .available)
    (context : Context) (busy : Bool) :
    sideMayCommit parent context busy = false := by
  simp [sideMayCommit, unavailable]

theorem snapshotCannotCommitAfterParentStarts :
    sideMayCommit .available .snapshot true = false := rfl

theorem committedHeadRemainsAvailableWhileParentRuns :
    sideMayCommit .available .committedHead true = true := rfl

def sideMayStart (parentExists capturedWrite currentWrite wantsWrite : Bool) : Bool :=
  parentExists && (!wantsWrite || (capturedWrite && currentWrite))

theorem narrowedParentBlocksSideWrite :
    sideMayStart true true false true = false := rfl

theorem narrowedParentStillAllowsSideRead :
    sideMayStart true true false false = true := rfl

def forkMayCommit (source : Parent) (deleted : Bool) : Bool :=
  decide (source = .available) && !deleted

theorem deletedForkCannotCommit (source : Parent) :
    forkMayCommit source true = false := by simp [forkMayCommit]

theorem forkCannotCommitAfterSourceDeletion :
    forkMayCommit .deleted false = false := rfl

/-- An independent fork has provenance but no parent execution dependency. -/
def forkMayStart (committed : Bool) (_ : Parent) : Bool := committed

theorem independentForkCanStartAfterSourceDeletion :
    forkMayStart true .deleted = true := rfl

/-- The caller passes the current live, non-retiring parent run at admission. -/
def childMayStart (owner : Nat) (liveParent : Option Nat) : Bool :=
  decide (liveParent = some owner)

theorem childCannotStartAfterItsParentEnds (owner : Nat) :
    childMayStart owner none = false := rfl

theorem childCannotJoinADifferentParentRun {owner live : Nat} (different : live ≠ owner) :
    childMayStart owner (some live) = false := by
  simp [childMayStart, different]

theorem childCanStartUnderItsOwnLiveParent (owner : Nat) :
    childMayStart owner (some owner) = true := by simp [childMayStart]

end Dovo.ThreadStart
