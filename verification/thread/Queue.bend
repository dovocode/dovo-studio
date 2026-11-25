import Base

type Phase is Data:
  Finalizing{}
  Held{}
  SavedPaused{}
  Scheduled{}
  AwaitingProviderAck{}
  Uncertain{}

type Action is Data:
  Save{reply: Nat}
  Start{message: Nat}

type State is Type:
  Queue{phase: Phase, reply: Nat, next: Nat, history: List<Action>}

# A's reply is recorded, its checkpoint exists, and B is the eligible queue head.
def initial(reply: Nat, next: Nat) -> State:
  Queue{Finalizing{}, reply, next, Nil{}}

def refresh(first_read: Bool, retry_read: Bool) -> Bool:
  match first_read:
    case True{}: True{}
    case False{}: retry_read

# History records finalization and provider starts, newest first.
def save(state: State, ready: Bool) -> State:
  match state:
    case Queue{phase, +reply, next, history}:
      match phase:
        case Finalizing{}:
          match ready:
            case True{}: Queue{Scheduled{}, reply, next, Con{Save{reply}, history}}
            case False{}: Queue{Held{}, reply, next, history}
        case Held{}:
          match ready:
            case True{}: Queue{SavedPaused{}, reply, next, Con{Save{reply}, history}}
            case False{}: Queue{Held{}, reply, next, history}
        case other: Queue{other, reply, next, history}

def worker(state: State) -> State:
  match state:
    case Queue{phase, reply, +next, history}:
      match phase:
        case Scheduled{}: Queue{AwaitingProviderAck{}, reply, next, Con{Start{next}, history}}
        case other: Queue{other, reply, next, history}

def unpause_saved(state: State) -> State:
  match state:
    case Queue{phase, reply, next, history}:
      match phase:
        case SavedPaused{}: Queue{Scheduled{}, reply, next, history}
        case other: Queue{other, reply, next, history}

# Queue Resume also finishes a pending save. Save-only retry calls save on its own.
def resume(state: State, ready: Bool) -> State:
  unpause_saved(save(state, ready))

def pause(state: State) -> State:
  match state:
    case Queue{phase, reply, next, history}:
      match phase:
        case Finalizing{}: Queue{Held{}, reply, next, history}
        case Scheduled{}: Queue{SavedPaused{}, reply, next, history}
        case other: Queue{other, reply, next, history}

def interrupt_dispatch(state: State) -> State:
  match state:
    case Queue{phase, reply, next, history}:
      match phase:
        case AwaitingProviderAck{}: Queue{Uncertain{}, reply, next, history}
        case other: Queue{other, reply, next, history}

def restart(state: State) -> State:
  interrupt_dispatch(pause(state))

type BackgroundEvent is Data:
  Restart{}
  Worker{}

def background(events: List<BackgroundEvent>, state: State) -> State:
  match events:
    case Nil{}: state
    case Con{event, rest}:
      match event:
        case Restart{}: background(rest, restart(state))
        case Worker{}: background(rest, worker(state))
