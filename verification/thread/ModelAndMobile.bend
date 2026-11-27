import Base

type ModelSettings is Type:
  Settings{model: Nat, reasoning: Nat, tier: Nat, write: Bool}

def next_defaults(persistent: Bool, previous: ModelSettings, selected: ModelSettings) -> ModelSettings:
  match persistent:
    case False{}: previous
    case True{}:
      match previous:
        case Settings{old, old_reasoning, old_tier, write}:
          match selected:
            case Settings{model, reasoning, tier, turn_write}: Settings{model, reasoning, tier, write}

def may_switch(worker_retired: Bool, session_released: Bool) -> Bool:
  match worker_retired:
    case False{}: False{}
    case True{}: session_released

def may_clear_fork(accepted: Bool, edited: Bool, matches: Bool) -> Bool:
  match accepted:
    case True{}: False{}
    case False{}:
      match edited:
        case True{}: False{}
        case False{}: matches

law model_persists_with_old_access:
  for old: Nat
  for old_reasoning: Nat
  for old_tier: Nat
  for model: Nat
  for reasoning: Nat
  for tier: Nat
  for write: Bool
  for turn_write: Bool
  {next_defaults(True{}, Settings{old, old_reasoning, old_tier, write}, Settings{model, reasoning, tier, turn_write}) == Settings{model, reasoning, tier, write} : ModelSettings}

law legacy_default_does_not_change:
  for previous: ModelSettings
  for selected: ModelSettings
  {next_defaults(False{}, previous, selected) == previous : ModelSettings}

law live_worker_blocks_switch:
  for released: Bool
  {may_switch(False{}, released) == False{} : Bool}

law released_worker_and_session_allow_switch:
  {may_switch(True{}, True{}) == True{} : Bool}

law edited_fork_keeps_equal_text:
  {may_clear_fork(False{}, True{}, True{}) == False{} : Bool}

law first_acknowledgement_clears_matching_untouched_fork:
  {may_clear_fork(False{}, False{}, True{}) == True{} : Bool}

law completed_fork_cannot_clear_follow_up:
  for edited: Bool
  for matches: Bool
  {may_clear_fork(True{}, edited, matches) == False{} : Bool}
