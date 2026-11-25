import Base

type Run is Data:
  RunningStep{}
  PausingAfterStep{}
  PausedAtBoundary{}
  ReadyForNextStep{}
  PausedCI{}
  WaitingForCI{}

def pause(run: Run) -> Run:
  match run:
    case RunningStep{}: PausingAfterStep{}
    case WaitingForCI{}: PausedCI{}
    case other: other

def finish_step(run: Run) -> Run:
  match run:
    case RunningStep{}: ReadyForNextStep{}
    case PausingAfterStep{}: PausedAtBoundary{}
    case other: other

def resume(run: Run) -> Run:
  match run:
    case PausingAfterStep{}: RunningStep{}
    case PausedAtBoundary{}: ReadyForNextStep{}
    case PausedCI{}: WaitingForCI{}
    case other: other

def ci_wake(run: Run, current_read: Bool) -> Run:
  match run:
    case WaitingForCI{}:
      match current_read:
        case True{}: ReadyForNextStep{}
        case False{}: WaitingForCI{}
    case other: other

law pause_holds_at_step_boundary:
  {finish_step(pause(RunningStep{})) == PausedAtBoundary{} : Run}

law undo_pause_request_keeps_worker_running:
  {resume(pause(RunningStep{})) == RunningStep{} : Run}

law resume_restores_ci_wait_and_ignores_stale_read:
  {ci_wake(resume(pause(WaitingForCI{})), False{}) == WaitingForCI{} : Run}

law pause_blocks_ci_wake:
  {ci_wake(pause(WaitingForCI{}), True{}) == PausedCI{} : Run}

type Question is Data:
  Pending{}
  Withdrawn{}
  Answered{value: Nat}

def withdraw(question: Question, owned: Bool) -> Question:
  match question:
    case Pending{}:
      match owned:
        case False{}: Pending{}
        case True{}: Withdrawn{}
    case other: other

def answer(question: Question, value: Nat) -> Question:
  match question:
    case Pending{}: Answered{value}
    case other: other

law withdrawal_rejects_late_answer:
  for value: Nat
  {answer(withdraw(withdraw(Pending{}, True{}), True{}), value) == Withdrawn{} : Question}

law withdrawal_preserves_other_run_question:
  {withdraw(Pending{}, False{}) == Pending{} : Question}
