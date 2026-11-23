import Lean

namespace Dovo.RuntimeRegistry

/-- Compare one value from the current registry, the reader's base, and their intended edit. -/
def mergeValue [DecidableEq α] (current before next : α) : Option α :=
  if before = next then some current
  else if current = before ∨ current = next then some next
  else none

theorem uneditedValueKeepsConcurrentChange [DecidableEq α] (current before : α) :
    mergeValue current before before = some current := by simp [mergeValue]

theorem rejectedConflictCannotOverwrite [DecidableEq α] {current before next : α}
    (edited : before ≠ next) (concurrent : current ≠ before) (different : current ≠ next) :
    mergeValue current before next = none := by simp [mergeValue, edited, concurrent, different]

theorem acceptedEditCanBeReplayed [DecidableEq α] {current before next merged : α}
    (applied : mergeValue current before next = some merged) :
    mergeValue merged before next = some merged := by
  by_cases unchanged : before = next
  · simp [mergeValue, unchanged]
  · simp [mergeValue, unchanged] at applied
    obtain ⟨_, rfl⟩ := applied
    simp [mergeValue, unchanged]

inductive Computer where
  | first | second
  deriving DecidableEq, Lean.ToJson

structure Registry where
  first : Option Nat := none
  second : Option Nat := none
  pending : Option Nat := none
  active : Option Computer := none
  deriving DecidableEq, Lean.ToJson

def Registry.profile (registry : Registry) : Computer → Option Nat
  | .first => registry.first
  | .second => registry.second

def select (registry : Registry) (current before next : Option Computer) : Option Computer :=
  (if next = before then current else next).filter (fun id => (registry.profile id).isSome)

def merge (current before next : Registry) : Option Registry := do
  let first ← mergeValue current.first before.first next.first
  let second ← mergeValue current.second before.second next.second
  let pending ← mergeValue current.pending before.pending next.pending
  let merged : Registry := { first, second, pending }
  pure { merged with active := select merged current.active before.active next.active }

theorem selectionReplay (registry : Registry) (current before next : Option Computer) :
    select registry (select registry current before next) before next =
      select registry current before next := by
  by_cases unchanged : next = before
  · cases current with
    | none => simp [select, unchanged]
    | some id =>
      by_cases saved : (registry.profile id).isSome <;> simp [select, unchanged, Option.filter, saved]
  · simp [select, unchanged]

theorem disjointProfileEditsJoin (before : Registry) (first second : Option Nat) :
    (merge { before with first := first } before { before with second := second }).map
      (fun result => (result.first, result.second, result.pending)) =
        some (first, second, before.pending) := by
  have change : mergeValue before.second before.second second = some second := by
    by_cases same : before.second = second <;> simp [mergeValue, same]
  simp [merge, uneditedValueKeepsConcurrentChange, change]

theorem anyConflictRejectsWholeMerge {current before next : Registry}
    (conflict : mergeValue current.first before.first next.first = none ∨
      mergeValue current.second before.second next.second = none ∨
      mergeValue current.pending before.pending next.pending = none) :
    merge current before next = none := by
  rcases conflict with first | second | pending
  · simp [merge, first]
  · unfold merge
    cases mergeValue current.first before.first next.first <;> simp [second]
  · unfold merge
    cases mergeValue current.first before.first next.first <;>
      cases mergeValue current.second before.second next.second <;> simp [pending]

theorem activeSelectionAlwaysReferencesSavedProfile {current before next result : Registry}
    (merged : merge current before next = some result) {selected : Computer}
    (active : result.active = some selected) : (result.profile selected).isSome = true := by
  unfold merge at merged
  cases firstResult : mergeValue current.first before.first next.first <;> simp [firstResult] at merged
  case some first =>
    cases secondResult : mergeValue current.second before.second next.second <;>
      simp [secondResult] at merged
    case some second =>
      cases pendingResult : mergeValue current.pending before.pending next.pending <;>
        simp [pendingResult] at merged
      case some pending =>
        subst result
        unfold select at active
        cases selection : (if next.active = before.active then current.active else next.active) with
        | none => simp [selection] at active
        | some candidate =>
          by_cases saved : ({ first, second, pending } : Registry).profile candidate |>.isSome
          · simp [selection, Option.filter, saved] at active
            subst selected
            exact saved
          · simp [selection, Option.filter, saved] at active

theorem acceptedRegistryUpdateCanBeReplayed {current before next result : Registry}
    (applied : merge current before next = some result) :
    merge result before next = some result := by
  unfold merge at applied
  cases firstResult : mergeValue current.first before.first next.first <;> simp [firstResult] at applied
  case some first =>
    cases secondResult : mergeValue current.second before.second next.second <;>
      simp [secondResult] at applied
    case some second =>
      cases pendingResult : mergeValue current.pending before.pending next.pending <;>
        simp [pendingResult] at applied
      case some pending =>
        subst result
        simp [merge, acceptedEditCanBeReplayed firstResult, acceptedEditCanBeReplayed secondResult,
          acceptedEditCanBeReplayed pendingResult, selectionReplay]

structure Input where
  name : String
  current : Registry
  before : Registry
  next : Registry
  deriving Lean.ToJson

def Input.result (input : Input) : Lean.Json :=
  Lean.Json.mkObj [
    ("input", Lean.toJson input),
    ("merged", Lean.toJson (merge input.current input.before input.next))]

private def values : List (Option Nat) := [none, some 1, some 2]

private def cases : List Input :=
  (values.flatMap fun current => values.flatMap fun before => values.map fun next =>
    { name := s!"profile {repr current}/{repr before}/{repr next}"
      current := { first := current, second := some 2 },
      before := { first := before, second := some 1 },
      next := { first := next, second := some 1 } }) ++
  (values.flatMap fun current => values.flatMap fun before => values.map fun next =>
    { name := s!"pairing {repr current}/{repr before}/{repr next}"
      current := { pending := current }, before := { pending := before }, next := { pending := next } }) ++ [
    ⟨"different window edits different computer", { first := some 2, second := some 1 },
      { first := some 1, second := some 1 }, { first := some 1, second := some 2 }⟩,
    ⟨"conflict on second profile rejects the first edit",
      { first := some 1, second := some 2 }, { first := some 1, second := some 1 },
      { first := some 2 }⟩,
    ⟨"pairing conflict rejects the profile edit",
      { first := some 1, pending := some 2 }, { first := some 1, pending := some 1 },
      { first := some 2 }⟩,
    ⟨"unchanged selection follows current window", { first := some 1, second := some 1, active := some .second },
      { first := some 1, second := some 1, active := some .first },
      { first := some 2, second := some 1, active := some .first }⟩,
    ⟨"explicit choice of a forgotten computer clears selection", { second := some 1, active := some .second },
      { first := some 1, second := some 1, active := some .second },
      { first := some 1, second := some 1, active := some .first }⟩,
    ⟨"removing selected computer keeps concurrent selection when valid",
      { first := some 1, second := some 1, active := some .second },
      { first := some 1, second := some 1 },
      { second := some 1 }⟩,
    ⟨"removing the newly selected computer clears selection", { first := some 1, second := some 1, active := some .first },
      { first := some 1, second := some 1 },
      { second := some 1 }⟩
  ]

def renderCases : String :=
  String.intercalate "\n" (cases.map fun input => input.result.compress)

end Dovo.RuntimeRegistry

def main : IO Unit := IO.println Dovo.RuntimeRegistry.renderCases
