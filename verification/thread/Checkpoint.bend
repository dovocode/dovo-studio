import Base

# One completed turn in one checkout. A tree is an opaque Git object ID.
type State is Data:
  Missing{}
  Published{tree: Nat}
  Recorded{tree: Nat}

def publish(state: State, working_tree: Nat) -> State:
  match state:
    case Missing{}: Published{working_tree}
    case other: other

def record(state: State, sqlite_ready: Bool) -> State:
  match state:
    case Published{tree}:
      match sqlite_ready:
        case True{}: Recorded{tree}
        case False{}: Published{tree}
    case other: other
