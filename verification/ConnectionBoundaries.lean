import Std

namespace Dovo.ConnectionCache

structure Host where
  generation : Nat
  credential : Option Nat
  snapshot : Option Nat

structure Handle where
  generation : Nat
  credential : Nat
  live : Bool := true

def canUse (host : Host) (handle : Handle) : Bool :=
  handle.live && decide
    (host.generation = handle.generation ∧ host.credential = some handle.credential)

def replacePairing (host : Host) (credential : Option Nat) : Host :=
  ⟨host.generation + 1, credential, none⟩

def read (host : Host) (handle : Handle) : Option Nat :=
  if canUse host handle then host.snapshot else none

def write (host : Host) (handle : Handle) (value : Option Nat) : Host :=
  if canUse host handle then { host with snapshot := value } else host

def forget (host : Host) (handle : Handle) : Host :=
  if canUse host handle then replacePairing host none else host

theorem oldHandleCannotReadWriteOrForgetAfterReplacement {host : Host} {old : Handle}
    (captured : old.generation = host.generation) (credential : Option Nat) (value : Option Nat) :
    let paired := replacePairing host credential
    read paired old = none ∧ write paired old value = paired ∧ forget paired old = paired := by
  simp [replacePairing, read, write, forget, canUse, captured]

theorem closedHandleCannotChangeCurrentPairing (host : Host) (handle : Handle) (value : Option Nat) :
    write host { handle with live := false } value = host ∧
      forget host { handle with live := false } = host := by
  simp [write, forget, canUse]

theorem renewedCredentialCanPublishAfterForget (host : Host) (credential value : Nat) :
    let paired := replacePairing (replacePairing host none) (some credential)
    let renewed : Handle := ⟨paired.generation, credential, true⟩
    read (write paired renewed (some value)) renewed = some value := by
  simp [read, write, canUse, replacePairing]

end Dovo.ConnectionCache

namespace Dovo.PullOverview

def lookup (number : Nat) : List (Nat × α) → Option α
  | [] => none
  | (id, value) :: rest => if id = number then some value else lookup number rest

theorem lookupAppended (number : Nat) (earlier later : List (Nat × α)) :
    lookup number (earlier ++ later) = (lookup number earlier).orElse (fun _ => lookup number later) := by
  induction earlier with
  | nil => rfl
  | cons row earlier ih =>
    rcases row with ⟨id, value⟩
    by_cases same : id = number <;> simp [lookup, same, ih, Option.orElse]

theorem earlierDetailsWin (earlier later : List (Nat × α)) (number : Nat) (value : α)
    (found : lookup number earlier = some value) :
    lookup number (earlier ++ later) = some value := by
  simp [lookupAppended, found, Option.orElse]

theorem missingEarlierRowUsesLaterPage (earlier later : List (Nat × α)) (number : Nat)
    (missing : lookup number earlier = none) :
    lookup number (earlier ++ later) = lookup number later := by
  simp [lookupAppended, missing, Option.orElse]

end Dovo.PullOverview
