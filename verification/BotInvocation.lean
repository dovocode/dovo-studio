import Lean

namespace Dovo.BotInvocation

inductive Scope where
  | thread | mentionCopy | coordinator | invocation
  deriving DecidableEq, Lean.ToJson

def inheritsProject : Scope → Bool
  | .thread | .mentionCopy => true
  | .coordinator | .invocation => false

def resource (inherited own : Option Bool) (disabled : Bool) : Option Bool :=
  match own with
  | some enabled => some enabled
  | none => inherited.map (fun enabled => enabled && !disabled)

theorem invocationSkipsProject : inheritsProject .invocation = false := rfl

theorem historyCopyKeepsProject : inheritsProject .mentionCopy = true := rfl

theorem ownDefinitionWins (inherited : Option Bool) (enabled disabled : Bool) :
    resource inherited (some enabled) disabled = some enabled := rfl

theorem disabledInheritedCannotRun (inherited : Option Bool) :
    resource inherited none true ≠ some true := by
  cases inherited <;> simp [resource]

theorem enabledResourceComesFromBotOrInheritance (inherited own : Option Bool)
    (disabled : Bool) (enabled : resource inherited own disabled = some true) :
    own = some true ∨ (own = none ∧ inherited = some true ∧ disabled = false) := by
  cases own <;> cases inherited <;> simp_all [resource]

def invocationResource (sameHost available : Bool) (inherited own : Option Bool) (disabled : Bool) :
    Option Bool :=
  if sameHost && available then resource inherited own disabled else none

theorem foreignCoordinatorCannotSupplyResources (available : Bool) (inherited own : Option Bool)
    (disabled : Bool) :
    invocationResource false available inherited own disabled = none := rfl

theorem missingCoordinatorCannotSupplyResources (sameHost : Bool) (inherited own : Option Bool)
    (disabled : Bool) :
    invocationResource sameHost false inherited own disabled = none := by
  simp [invocationResource]

structure Input where
  scope : Scope
  inherited : Option Bool
  own : Option Bool
  disabled : Bool
  deriving Lean.ToJson

def renderCases : String :=
  let states := [none, some false, some true]
  let scopes := [Scope.thread, .mentionCopy, .coordinator, .invocation]
  let cases := scopes.flatMap fun scope => states.flatMap fun inherited =>
    states.flatMap fun own => [false, true].map fun disabled =>
      { scope, inherited, own, disabled : Input }
  String.intercalate "\n" (cases.map fun input =>
    (Lean.Json.mkObj [
      ("input", Lean.toJson input),
      ("inheritsProject", Lean.toJson (inheritsProject input.scope)),
      ("resource", Lean.toJson (resource input.inherited input.own input.disabled)),
      ("invocation", Lean.toJson (invocationResource true true input.inherited input.own input.disabled)),
      ("missingCoordinator", Lean.toJson (invocationResource true false input.inherited input.own input.disabled)),
      ("foreignCoordinator", Lean.toJson (invocationResource false true input.inherited input.own input.disabled))
    ]).compress)

end Dovo.BotInvocation

def main : IO Unit := IO.println Dovo.BotInvocation.renderCases
