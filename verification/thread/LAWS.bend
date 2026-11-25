import Base
import ./Queue.bend as Q
import ./Send.bend as S
import ./Checkpoint.bend as C

law saved_reply_starts_next:
  for reply: Nat
  for next: Nat
  for retry: Bool
  saved = Q.save(Q.initial(reply, next), Q.refresh(True{}, retry))
  {Q.worker(saved) == Q.Queue{Q.AwaitingProviderAck{}, reply, next, [Q.Start{next}, Q.Save{reply}]} : Q.State}

law one_missed_read_recovers:
  for reply: Nat
  for next: Nat
  saved = Q.save(Q.initial(reply, next), Q.refresh(False{}, True{}))
  {Q.worker(saved) == Q.Queue{Q.AwaitingProviderAck{}, reply, next, [Q.Start{next}, Q.Save{reply}]} : Q.State}

law two_missed_reads_hold:
  for reply: Nat
  for next: Nat
  held = Q.save(Q.initial(reply, next), Q.refresh(False{}, False{}))
  {Q.worker(held) == Q.Queue{Q.Held{}, reply, next, Nil{}} : Q.State}

law retry_keeps_queue_paused:
  for reply: Nat
  for next: Nat
  saved = Q.save(Q.Queue{Q.Held{}, reply, next, Nil{}}, True{})
  {Q.worker(saved) == Q.Queue{Q.SavedPaused{}, reply, next, [Q.Save{reply}]} : Q.State}

law resume_starts_next_after_save:
  for reply: Nat
  for next: Nat
  saved = Q.save(Q.Queue{Q.Held{}, reply, next, Nil{}}, True{})
  {Q.worker(Q.resume(saved, True{})) == Q.Queue{Q.AwaitingProviderAck{}, reply, next, [Q.Start{next}, Q.Save{reply}]} : Q.State}

law duplicate_work_is_inert:
  for reply: Nat
  for next: Nat
  for history: List<Q.Action>
  for ready: Bool
  saved = Q.save(Q.Queue{Q.AwaitingProviderAck{}, reply, next, history}, ready)
  {Q.worker(Q.resume(saved, True{})) == Q.Queue{Q.AwaitingProviderAck{}, reply, next, history} : Q.State}

law lost_reply_keeps_saved_send:
  for cache: Bool
  for wrote: Bool
  lost = S.deliver(S.staged())
  {S.compact(S.settle(lost, cache, wrote)) == S.Send{S.Recorded{}, S.WaitingForReply{}, 1n} : S.State}

law missing_cache_keeps_saved_send:
  for wrote: Bool
  known = S.acknowledge(S.deliver(S.staged()))
  {S.compact(S.settle(known, False{}, wrote)) == S.Send{S.Recorded{}, S.WaitingForCache{}, 1n} : S.State}

law failed_removal_preserves_receipt:
  known = S.acknowledge(S.deliver(S.staged()))
  {S.compact(S.settle(known, True{}, False{})) == S.Send{S.Recorded{}, S.WaitingForCache{}, 1n} : S.State}

law reconnect_completes_one_admission:
  lost = S.deliver(S.staged())
  known = S.acknowledge(S.deliver(lost))
  cleared = S.settle(known, True{}, True{})
  {S.deliver(S.compact(cleared)) == S.Send{S.Retired{}, S.Cleared{}, 1n} : S.State}

law restart_before_claim_parks_next:
  for reply: Nat
  for next: Nat
  saved = Q.save(Q.initial(reply, next), True{})
  {Q.restart(saved) == Q.Queue{Q.SavedPaused{}, reply, next, [Q.Save{reply}]} : Q.State}

law parked_until_explicit_resume:
  for events: List<Q.BackgroundEvent>
  for reply: Nat
  for next: Nat
  for history: List<Q.Action>
  parked = Q.background(events, Q.Queue{Q.SavedPaused{}, reply, next, history})
  {parked == Q.Queue{Q.SavedPaused{}, reply, next, history} : Q.State}

law resume_after_restart_dispatches_once:
  for reply: Nat
  for next: Nat
  saved = Q.save(Q.initial(reply, next), True{})
  resumed = Q.resume(Q.restart(saved), True{})
  {Q.worker(Q.worker(resumed)) == Q.Queue{Q.AwaitingProviderAck{}, reply, next, [Q.Start{next}, Q.Save{reply}]} : Q.State}

law restart_after_dispatch_records_uncertainty:
  for reply: Nat
  for next: Nat
  saved = Q.save(Q.initial(reply, next), True{})
  started = Q.worker(saved)
  {Q.restart(started) == Q.Queue{Q.Uncertain{}, reply, next, [Q.Start{next}, Q.Save{reply}]} : Q.State}

law uncertain_dispatch_survives_background_work:
  for events: List<Q.BackgroundEvent>
  for reply: Nat
  for next: Nat
  for history: List<Q.Action>
  held = Q.background(events, Q.Queue{Q.Uncertain{}, reply, next, history})
  {held == Q.Queue{Q.Uncertain{}, reply, next, history} : Q.State}

law pause_during_save_holds_next:
  for reply: Nat
  for next: Nat
  saved = Q.save(Q.pause(Q.initial(reply, next)), True{})
  {Q.worker(saved) == Q.Queue{Q.SavedPaused{}, reply, next, [Q.Save{reply}]} : Q.State}

law resume_finishes_pending_save_before_dispatch:
  for reply: Nat
  for next: Nat
  held = Q.save(Q.initial(reply, next), False{})
  {Q.worker(Q.resume(held, True{})) == Q.Queue{Q.AwaitingProviderAck{}, reply, next, [Q.Start{next}, Q.Save{reply}]} : Q.State}

law resume_with_unavailable_save_keeps_next_held:
  for reply: Nat
  for next: Nat
  held = Q.save(Q.initial(reply, next), False{})
  {Q.worker(Q.resume(held, False{})) == Q.Queue{Q.Held{}, reply, next, Nil{}} : Q.State}

law first_published_tree_wins:
  for original: Nat
  for later: Nat
  published = C.publish(C.Missing{}, original)
  {C.publish(published, later) == C.Published{original} : C.State}

law retry_records_the_tree_from_the_turn:
  for original: Nat
  for later: Nat
  interrupted = C.record(C.publish(C.Missing{}, original), False{})
  recovered = C.publish(interrupted, later)
  {C.record(recovered, True{}) == C.Recorded{original} : C.State}
