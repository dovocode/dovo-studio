import Base

type Phase is Data:
  RunningOld{}
  StoppingOld{}
  SlotReady{}
  DispatchingNext{}
  RecoveringNext{}

type State is Type:
  Pool{phase: Phase, older: Nat, next: Nat, starts: List<Nat>}

def stop(state: State) -> State:
  match state:
    case Pool{phase, older, next, starts}:
      match phase:
        case RunningOld{}: Pool{StoppingOld{}, older, next, starts}
        case other: Pool{other, older, next, starts}

# The caller must have observed the current worker's confirmed exit.
def confirm_exit(state: State) -> State:
  match state:
    case Pool{phase, older, next, starts}:
      match phase:
        case StoppingOld{}: Pool{SlotReady{}, older, next, starts}
        case other: Pool{other, older, next, starts}

def dispatch(state: State) -> State:
  match state:
    case Pool{phase, older, +next, starts}:
      match phase:
        case SlotReady{}: Pool{DispatchingNext{}, older, next, Con{next, starts}}
        case other: Pool{other, older, next, starts}

def restart(state: State) -> State:
  match state:
    case Pool{phase, older, next, starts}:
      match phase:
        case DispatchingNext{}: Pool{RecoveringNext{}, older, next, starts}
        case other: Pool{other, older, next, starts}

type BackgroundEvent is Data:
  WorkerSchedule{}
  WorkerRestart{}

def background(events: List<BackgroundEvent>, state: State) -> State:
  match events:
    case Nil{}: state
    case Con{event, rest}:
      match event:
        case WorkerSchedule{}: background(rest, dispatch(state))
        case WorkerRestart{}: background(rest, restart(state))
