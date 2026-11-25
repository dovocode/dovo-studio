import Base

# One durable first-message ID and its original payload, scoped to the same thread and runtime.
type Receipt is Data:
  Missing{}
  Recorded{}
  Retired{}

type Outbox is Data:
  WaitingForReply{}
  WaitingForCache{}
  Cleared{}

type State is Data:
  Send{receipt: Receipt, outbox: Outbox, admissions: Nat}

def staged() -> State:
  Send{Missing{}, WaitingForReply{}, 0n}

# Server commit. The reply can be lost after this step.
def deliver(state: State) -> State:
  match state:
    case Send{receipt, outbox, count}:
      match receipt:
        case Missing{}: Send{Recorded{}, outbox, 1n+count}
        case other: Send{other, outbox, count}

# Reconnect can observe the original receipt even when the send reply was lost.
def acknowledge(state: State) -> State:
  match state:
    case Send{receipt, outbox, count}:
      match receipt:
        case Recorded{}:
          match outbox:
            case WaitingForReply{}: Send{Recorded{}, WaitingForCache{}, count}
            case other: Send{Recorded{}, other, count}
        case other: Send{other, outbox, count}

def settle(state: State, matching_cache: Bool, removal_written: Bool) -> State:
  match state:
    case Send{receipt, outbox, count}:
      match outbox:
        case WaitingForCache{}:
          match matching_cache:
            case True{}:
              match removal_written:
                case True{}: Send{receipt, Cleared{}, count}
                case False{}: Send{receipt, WaitingForCache{}, count}
            case False{}: Send{receipt, WaitingForCache{}, count}
        case other: Send{receipt, other, count}

def compact(state: State) -> State:
  match state:
    case Send{receipt, outbox, count}:
      match receipt:
        case Recorded{}:
          match outbox:
            case Cleared{}: Send{Retired{}, Cleared{}, count}
            case other: Send{Recorded{}, other, count}
        case other: Send{other, outbox, count}
