import Base

type Selection is Data:
  Closed{}
  Open{reference: Nat, comment: Nat}

type Entry is Data:
  Quote{reference: Nat, comment: Nat}

type Draft is Type:
  Composer{selection: Selection, quotes: List<Entry>}

def update_comment(draft: Draft, transcript: Nat) -> Draft:
  match draft:
    case Composer{selection, quotes}:
      match selection:
        case Closed{}: Composer{Closed{}, quotes}
        case Open{reference, comment}: Composer{Open{reference, transcript}, quotes}

def cancel(draft: Draft) -> Draft:
  match draft:
    case Composer{selection, quotes}: Composer{Closed{}, quotes}

def add_quote(draft: Draft) -> Draft:
  match draft:
    case Composer{selection, quotes}:
      match selection:
        case Closed{}: Composer{Closed{}, quotes}
        case Open{reference, comment}: Composer{Closed{}, Con{Quote{reference, comment}, quotes}}

law cancelled_quote_leaves_draft_intact:
  for reference: Nat
  for comment: Nat
  for transcript: Nat
  for quotes: List<Entry>
  {update_comment(cancel(Composer{Open{reference, comment}, quotes}), transcript) == Composer{Closed{}, quotes} : Draft}

law confirmed_quote_includes_latest_comment_once:
  for reference: Nat
  for comment: Nat
  for transcript: Nat
  for quotes: List<Entry>
  {add_quote(add_quote(update_comment(Composer{Open{reference, comment}, quotes}, transcript))) == Composer{Closed{}, Con{Quote{reference, transcript}, quotes}} : Draft}
