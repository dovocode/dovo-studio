import ./LAWS.bend as Laws
import ./Queue.bend as Q

def Laws.saved_reply_starts_next(reply, next, retry):
  {==}

def Laws.one_missed_read_recovers(reply, next):
  {==}

def Laws.two_missed_reads_hold(reply, next):
  {==}

def Laws.retry_keeps_queue_paused(reply, next):
  {==}

def Laws.resume_starts_next_after_save(reply, next):
  {==}

def Laws.duplicate_work_is_inert(reply, next, history, ready):
  {==}

def Laws.lost_reply_keeps_saved_send(cache, wrote):
  {==}

def Laws.missing_cache_keeps_saved_send(wrote):
  {==}

def Laws.failed_removal_preserves_receipt():
  {==}

def Laws.reconnect_completes_one_admission():
  {==}

def Laws.restart_before_claim_parks_next(reply, next):
  {==}

def Laws.parked_until_explicit_resume(events, reply, next, history):
  match events:
    case Nil{}: {==}
    case Con{event, rest}:
      match event:
        case Q.Restart{}: Laws.parked_until_explicit_resume(rest, reply, next, history)
        case Q.Worker{}: Laws.parked_until_explicit_resume(rest, reply, next, history)

def Laws.resume_after_restart_dispatches_once(reply, next):
  {==}

def Laws.restart_after_dispatch_records_uncertainty(reply, next):
  {==}

def Laws.uncertain_dispatch_survives_background_work(events, reply, next, history):
  match events:
    case Nil{}: {==}
    case Con{event, rest}:
      match event:
        case Q.Restart{}: Laws.uncertain_dispatch_survives_background_work(rest, reply, next, history)
        case Q.Worker{}: Laws.uncertain_dispatch_survives_background_work(rest, reply, next, history)

def Laws.pause_during_save_holds_next(reply, next):
  {==}

def Laws.resume_finishes_pending_save_before_dispatch(reply, next):
  {==}

def Laws.resume_with_unavailable_save_keeps_next_held(reply, next):
  {==}

def Laws.first_published_tree_wins(original, later):
  {==}

def Laws.retry_records_the_tree_from_the_turn(original, later):
  {==}
