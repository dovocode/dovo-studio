import ./LAWS.bend as L
import ./Pool.bend as P
import ./Review.bend as R
import ./StepPool.bend as S
import ./RunControl.bend as C

def L.cancellation_holds_slot(events, older, next, starts):
  match events:
    case Nil{}: {==}
    case Con{event, rest}:
      match event:
        case P.WorkerSchedule{}: L.cancellation_holds_slot(rest, older, next, starts)
        case P.WorkerRestart{}: L.cancellation_holds_slot(rest, older, next, starts)

def L.confirmed_exit_dispatches_next_once(older, next, starts):
  {==}

def L.uncertain_dispatch_is_never_repeated(events, older, next, starts):
  match events:
    case Nil{}: {==}
    case Con{event, rest}:
      match event:
        case P.WorkerSchedule{}: L.uncertain_dispatch_is_never_repeated(rest, older, next, starts)
        case P.WorkerRestart{}: L.uncertain_dispatch_is_never_repeated(rest, older, next, starts)

def R.required_reason_holds_review(allow):
  {==}

def R.stale_attempt_holds_review(required, allow, reason):
  {==}

def R.saved_review_cannot_be_replaced(allow, reason, other, replacement):
  {==}

def S.reserving_takes_first_unpaused_step(paused, first, rest, starts):
  {==}

def S.reserved_step_survives_restart_and_dispatches_once(step, requests, starts):
  {==}

def S.interrupted_step_is_not_dispatched_again(step, requests, starts):
  {==}

def C.pause_holds_at_step_boundary():
  {==}

def C.undo_pause_request_keeps_worker_running():
  {==}

def C.resume_restores_ci_wait_and_ignores_stale_read():
  {==}

def C.pause_blocks_ci_wake():
  {==}

def C.withdrawal_rejects_late_answer(value):
  {==}

def C.withdrawal_preserves_other_run_question():
  {==}
