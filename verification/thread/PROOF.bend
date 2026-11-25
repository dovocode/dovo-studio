import ./LAWS.bend as Laws
import ./Queue.bend as Q
import ./McpSignIn.bend as M
import ./LinkedRead.bend as A
import ./FilePages.bend as F
import ./QuoteDraft.bend as C
import ./TerminalPaste.bend as T

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

def M.stale_warning_cannot_start_consent(needs_sign_in):
  {==}

def M.current_warning_starts_consent():
  {==}

def M.connected_server_holds_consent():
  {==}

def M.old_session_cannot_expire_new_sign_in():
  {==}

def A.a_different_thread_cannot_publish(active_link, same_generation, body):
  {==}

def A.unlink_discards_in_flight_read(body):
  {==}

def A.relink_cannot_publish_an_old_read(body):
  {==}

def A.verified_link_publishes_read(body):
  {==}

def F.stale_cursor_requires_reload(stable_read, has_more, text, start, consumed):
  {==}

def F.changed_read_requires_reload(has_more, text, start, consumed):
  {==}

def F.next_page_starts_after_consumed_bytes(text, start, consumed):
  {==}

def F.end_of_file_has_no_cursor(text, start, consumed):
  {==}

def C.cancelled_quote_leaves_draft_intact(reference, comment, transcript, quotes):
  {==}

def C.confirmed_quote_includes_latest_comment_once(reference, comment, transcript, quotes):
  {==}

def T.first_chunk_writes_nothing(first):
  {==}

def T.middle_chunk_writes_nothing(first, second):
  {==}

def T.end_writes_the_whole_paste_once(first, second, last):
  {==}

def T.disconnected_paste_writes_nothing(chunks):
  {==}

def T.a_duplicate_end_writes_nothing(chunk):
  {==}
