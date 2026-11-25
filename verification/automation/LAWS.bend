import Base
import ./Pool.bend as P

law cancellation_holds_slot:
  for events: List<P.BackgroundEvent>
  for older: Nat
  for next: Nat
  for starts: List<Nat>
  stopped = P.stop(P.Pool{P.RunningOld{}, older, next, starts})
  {P.background(events, stopped) == P.Pool{P.StoppingOld{}, older, next, starts} : P.State}

law confirmed_exit_dispatches_next_once:
  for older: Nat
  for next: Nat
  for starts: List<Nat>
  dispatched = P.dispatch(P.confirm_exit(P.Pool{P.StoppingOld{}, older, next, starts}))
  {P.dispatch(P.confirm_exit(dispatched)) == P.Pool{P.DispatchingNext{}, older, next, Con{next, starts}} : P.State}

law uncertain_dispatch_is_never_repeated:
  for events: List<P.BackgroundEvent>
  for older: Nat
  for next: Nat
  for starts: List<Nat>
  dispatched = P.dispatch(P.Pool{P.SlotReady{}, older, next, starts})
  {P.background(events, P.restart(dispatched)) == P.Pool{P.RecoveringNext{}, older, next, Con{next, starts}} : P.State}
