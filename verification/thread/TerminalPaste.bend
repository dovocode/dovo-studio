import Base

type Paste is Type:
  Idle{}
  Pending{chunks: List<Nat>}

type Output is Type:
  Held{paste: Paste}
  Written{paste: Paste, chunks: List<Nat>}
  Invalid{}

# One state per terminal socket. Other sockets can write before the paste commits.
def begin(chunk: Nat) -> Output:
  Held{Pending{[chunk]}}

def append(chunks: List<Nat>, chunk: Nat) -> List<Nat>:
  match chunks:
    case Nil{}: [chunk]
    case Con{first, rest}: Con{first, append(rest, chunk)}

def more(paste: Paste, chunk: Nat) -> Output:
  match paste:
    case Idle{}: Invalid{}
    case Pending{chunks}: Held{Pending{append(chunks, chunk)}}

def finish(paste: Paste, chunk: Nat) -> Output:
  match paste:
    case Idle{}: Invalid{}
    case Pending{chunks}: Written{Idle{}, append(chunks, chunk)}

def disconnect(paste: Paste) -> Output:
  Held{Idle{}}

law first_chunk_writes_nothing:
  for first: Nat
  {begin(first) == Held{Pending{[first]}} : Output}

law middle_chunk_writes_nothing:
  for first: Nat
  for second: Nat
  {more(Pending{[first]}, second) == Held{Pending{[first, second]}} : Output}

law end_writes_the_whole_paste_once:
  for first: Nat
  for second: Nat
  for last: Nat
  {finish(Pending{[first, second]}, last) == Written{Idle{}, [first, second, last]} : Output}

law disconnected_paste_writes_nothing:
  for chunks: List<Nat>
  {disconnect(Pending{chunks}) == Held{Idle{}} : Output}

law a_duplicate_end_writes_nothing:
  for chunk: Nat
  {finish(Idle{}, chunk) == Invalid{} : Output}
