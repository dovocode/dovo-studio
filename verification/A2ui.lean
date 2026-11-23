import Std

namespace Dovo.A2ui

structure Version where
  revision : Nat
  draft : Nat
  deriving DecidableEq, Repr

inductive Phase where
  | editing
  | pending
  | sent
  | uncertain
  deriving DecidableEq, Repr

inductive Outcome where
  | sent
  | uncertain
  deriving DecidableEq, Repr

def Outcome.phase : Outcome → Phase
  | .sent => .sent
  | .uncertain => .uncertain

structure Card where
  version : Version
  phase : Phase
  -- Proof history. The runtime does not store this list or consult it for any guard.
  claims : List Nat
  deriving Repr

def initial : Card := ⟨⟨1, 0⟩, .editing, []⟩

def Version.advanceDraft (version : Version) : Version :=
  { version with draft := version.draft + 1 }

inductive Event where
  | publish (expectedRevision : Nat)
  | saveDraft (expected : Version)
  | approveAndClaim (approved : Version)
  | finish (revision : Nat) (outcome : Outcome)
  | restart
  deriving Repr

/-- Accepted transitions for one published card. Claim commits the lock before delivery starts. -/
inductive Step : Card → Event → Card → Prop where
  | publish {card : Card} :
      Step card (.publish card.version.revision)
        { card with version := ⟨card.version.revision + 1, 0⟩, phase := .editing }
  | saveDraft {card : Card} (editing : card.phase = .editing) :
      Step card (.saveDraft card.version)
        { card with version := card.version.advanceDraft }
  | approveAndClaim {card : Card} (editing : card.phase = .editing) :
      Step card (.approveAndClaim card.version)
        { card with
          version := card.version.advanceDraft
          phase := .pending
          claims := card.version.revision :: card.claims }
  | finish {card : Card} (pending : card.phase = .pending) (outcome : Outcome) :
      Step card (.finish card.version.revision outcome) { card with phase := outcome.phase }
  | restart {card : Card} : Step card .restart card

inductive Reachable : Card → Prop where
  | initial : Reachable initial
  | step {before after : Card} {event : Event} :
      Reachable before → Step before event after → Reachable after

theorem staleDraftCannotWrite {card next : Card} {expected : Version}
    (stale : expected ≠ card.version) :
    ¬ Step card (.saveDraft expected) next := by
  intro transition
  cases transition
  exact stale rfl

theorem staleApprovalCannotClaim {card next : Card} {approved : Version}
    (stale : approved ≠ card.version) :
    ¬ Step card (.approveAndClaim approved) next := by
  intro transition
  cases transition
  exact stale rfl

theorem lockedRevisionCannotClaim {card next : Card} {approved : Version}
    (locked : card.phase ≠ .editing) :
    ¬ Step card (.approveAndClaim approved) next := by
  intro transition
  cases transition with
  | approveAndClaim editing => exact locked editing

theorem staleDeliveryCannotFinish {card next : Card} {revision : Nat} {outcome : Outcome}
    (stale : revision ≠ card.version.revision) :
    ¬ Step card (.finish revision outcome) next := by
  intro transition
  cases transition
  exact stale rfl

theorem restartPreservesCard {card next : Card} (transition : Step card .restart next) :
    next = card := by
  cases transition
  rfl

theorem Step.keepsClaim {before after : Card} {event : Event} {revision : Nat}
    (transition : Step before event after) (claimed : revision ∈ before.claims) :
    revision ∈ after.claims := by
  cases transition
  case approveAndClaim => exact List.mem_cons_of_mem _ claimed
  all_goals exact claimed

structure Safe (card : Card) : Prop where
  noRepeat : card.claims.Nodup
  claimsAtMostCurrent : ∀ revision ∈ card.claims, revision ≤ card.version.revision
  editingUnclaimed : card.phase = .editing → card.version.revision ∉ card.claims

theorem Step.preservesSafety {before after : Card} {event : Event}
    (transition : Step before event after) (safe : Safe before) : Safe after := by
  cases transition with
  | publish =>
      refine ⟨safe.noRepeat, ?_, ?_⟩
      · intro revision member
        exact Nat.le_succ_of_le (safe.claimsAtMostCurrent revision member)
      · intro _ claimed
        change before.version.revision + 1 ∈ before.claims at claimed
        exact Nat.not_succ_le_self _ (safe.claimsAtMostCurrent _ claimed)
  | saveDraft =>
      exact ⟨safe.noRepeat, safe.claimsAtMostCurrent, safe.editingUnclaimed⟩
  | approveAndClaim editing =>
      refine ⟨List.nodup_cons.mpr ⟨safe.editingUnclaimed editing, safe.noRepeat⟩, ?_, ?_⟩
      · intro revision member
        rcases List.mem_cons.mp member with same | earlier
        · exact Nat.le_of_eq same
        · exact safe.claimsAtMostCurrent revision earlier
      · intro impossible
        cases impossible
  | finish _ outcome =>
      refine ⟨safe.noRepeat, safe.claimsAtMostCurrent, ?_⟩
      cases outcome <;> simp [Outcome.phase]
  | restart => exact safe

theorem Reachable.safe {card : Card} (reachable : Reachable card) : Safe card := by
  induction reachable with
  | initial =>
      refine ⟨?_, ?_, ?_⟩ <;> simp [Dovo.A2ui.initial]
  | step _ transition inductionHypothesis =>
      exact transition.preservesSafety inductionHypothesis

theorem eachRevisionClaimedAtMostOnce {card : Card} (reachable : Reachable card) :
    card.claims.Nodup :=
  reachable.safe.noRepeat

theorem claimedRevisionCannotClaimAgain {card next : Card} {approved : Version}
    (reachable : Reachable card) (claimed : approved.revision ∈ card.claims) :
    ¬ Step card (.approveAndClaim approved) next := by
  intro transition
  cases transition with
  | approveAndClaim editing => exact reachable.safe.editingUnclaimed editing claimed

end Dovo.A2ui
