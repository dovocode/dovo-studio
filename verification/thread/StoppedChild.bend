import Base

type Admission is Type:
  Reject{}
  Acknowledge{}
  Start{message: Nat, held: List<Nat>}

# Compare the observed stop when saving and again when admitting the run.
def admit(paired: Bool, started: Bool, save_current: Bool, run_current: Bool, message: Nat, held: List<Nat>) -> Admission:
  match paired:
    case False{}: Reject{}
    case True{}:
      match started:
        case True{}: Acknowledge{}
        case False{}:
          match save_current:
            case False{}: Reject{}
            case True{}:
              match run_current:
                case False{}: Reject{}
                case True{}: Start{message, held}

law fresh_human_input_starts_with_earlier_prompts_held:
  for message: Nat
  for held: List<Nat>
  {admit(True{}, False{}, True{}, True{}, message, held) == Start{message, held} : Admission}

law started_retry_does_not_start_again:
  for save_current: Bool
  for run_current: Bool
  for message: Nat
  for held: List<Nat>
  {admit(True{}, True{}, save_current, run_current, message, held) == Acknowledge{} : Admission}

law a_new_stop_before_run_rejects_admission:
  for message: Nat
  for held: List<Nat>
  {admit(True{}, False{}, True{}, False{}, message, held) == Reject{} : Admission}

law agent_input_cannot_resume:
  for started: Bool
  for save_current: Bool
  for run_current: Bool
  for message: Nat
  for held: List<Nat>
  {admit(False{}, started, save_current, run_current, message, held) == Reject{} : Admission}
