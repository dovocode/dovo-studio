import Base

# The saved queue includes paused requests, in step-arrival order.
type Slot is Data:
  Free{}
  Reserved{step: Nat}
  Executing{step: Nat}
  Interrupted{step: Nat}

type Request is Data:
  Waiting{step: Nat}
  Paused{step: Nat}

type Pool is Type:
  State{slot: Slot, requests: List<Request>, starts: List<Nat>}

def keep_paused(step: Nat, pool: Pool) -> Pool:
  match pool:
    case State{slot, requests, starts}: State{slot, Con{Paused{step}, requests}, starts}

def reserve_waiting(requests: List<Request>, starts: List<Nat>) -> Pool:
  match requests:
    case Nil{}: State{Free{}, Nil{}, starts}
    case Con{request, rest}:
      match request:
        case Paused{step}: keep_paused(step, reserve_waiting(rest, starts))
        case Waiting{step}: State{Reserved{step}, rest, starts}

def reserve(pool: Pool) -> Pool:
  match pool:
    case State{slot, requests, starts}:
      match slot:
        case Free{}: reserve_waiting(requests, starts)
        case other: State{other, requests, starts}

def dispatch(pool: Pool) -> Pool:
  match pool:
    case State{slot, requests, starts}:
      match slot:
        case Reserved{+step}: State{Executing{step}, requests, Con{step, starts}}
        case other: State{other, requests, starts}

def restart(pool: Pool) -> Pool:
  match pool:
    case State{slot, requests, starts}:
      match slot:
        case Executing{step}: State{Interrupted{step}, requests, starts}
        case other: State{other, requests, starts}

def complete(pool: Pool) -> Pool:
  match pool:
    case State{slot, requests, starts}:
      match slot:
        case Executing{_}: State{Free{}, requests, starts}
        case other: State{other, requests, starts}

def unpause(request: Request) -> Request:
  match request:
    case Paused{step}: Waiting{step}
    case other: other

# Select the saved request by its queue position and keep it in place.
def resume_at(requests: List<Request>, index: Nat) -> List<Request>:
  match requests:
    case Nil{}: Nil{}
    case Con{request, rest}:
      match index:
        case 0n: Con{unpause(request), rest}
        case 1n+previous: Con{request, resume_at(rest, previous)}

def resume(index: Nat, pool: Pool) -> Pool:
  match pool:
    case State{slot, requests, starts}: State{slot, resume_at(requests, index), starts}

law reserving_takes_first_unpaused_step:
  for paused: Nat
  for first: Nat
  for rest: List<Request>
  for starts: List<Nat>
  restored = restart(State{Free{}, Con{Paused{paused}, Con{Waiting{first}, rest}}, starts})
  {reserve(restored) == State{Reserved{first}, Con{Paused{paused}, rest}, starts} : Pool}

law paused_step_resumes_once_after_restart:
  for paused: Nat
  for first: Nat
  for rest: List<Request>
  for starts: List<Nat>
  restored = restart(State{Free{}, Con{Paused{paused}, Con{Waiting{first}, rest}}, starts})
  completed = complete(dispatch(reserve(restored)))
  resumed = reserve(resume(0n, completed))
  {dispatch(dispatch(resumed)) == State{Executing{paused}, rest, Con{paused, Con{first, starts}}} : Pool}

law reserved_step_survives_restart_and_dispatches_once:
  for step: Nat
  for requests: List<Request>
  for starts: List<Nat>
  restored = restart(State{Reserved{step}, requests, starts})
  {dispatch(dispatch(restored)) == State{Executing{step}, requests, Con{step, starts}} : Pool}

law interrupted_step_is_not_dispatched_again:
  for step: Nat
  for requests: List<Request>
  for starts: List<Nat>
  restored = restart(State{Executing{step}, requests, starts})
  {dispatch(reserve(restored)) == State{Interrupted{step}, requests, starts} : Pool}
