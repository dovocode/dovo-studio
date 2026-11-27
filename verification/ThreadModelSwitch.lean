namespace Dovo.ThreadModelSwitch

structure Model where
  id : Nat
  reasoning : Nat
  tier : Option Nat
  deriving DecidableEq

structure Settings where
  model : Model
  canWrite : Bool
  deriving DecidableEq

structure Admission where
  selected : Settings
  defaults : Settings

def admit (persistent : Bool) (defaults : Settings) (choice : Option Settings) : Admission :=
  let selected := choice.getD defaults
  ⟨selected, if persistent then { defaults with model := selected.model } else defaults⟩

theorem nextTurnInheritsAdmittedModel (defaults selected : Settings) :
    (admit true (admit true defaults (some selected)).defaults none).selected.model =
      selected.model := rfl

theorem turnAccessNeverBecomesDefault (persistent : Bool) (defaults : Settings)
    (choice : Option Settings) :
    (admit persistent defaults choice).defaults.canWrite = defaults.canWrite := by
  cases persistent <;> rfl

theorem olderRuntimeKeepsThreadDefaults (defaults : Settings) (choice : Option Settings) :
    (admit false defaults choice).defaults = defaults := rfl

def commitDiscovery (generation captured : Nat) (automatic available : Bool) : Bool :=
  decide (generation = captured) && automatic && available

theorem staleDiscoveryCannotCommit {generation captured : Nat} (stale : generation ≠ captured)
    (automatic available : Bool) :
    commitDiscovery generation captured automatic available = false := by
  simp [commitDiscovery, stale]

theorem manualSelectionWins (generation captured : Nat) (available : Bool) :
    commitDiscovery generation captured false available = false := by
  simp [commitDiscovery]

def switchHarness (workerRetired providerReleased hasInputs : Bool) : Bool :=
  workerRetired && providerReleased && !hasInputs

theorem liveWorkerBlocksSwitch (released inputs : Bool) :
    switchHarness false released inputs = false := rfl

theorem retainedSessionBlocksSwitch (inputs : Bool) :
    switchHarness true false inputs = false := rfl

end Dovo.ThreadModelSwitch
