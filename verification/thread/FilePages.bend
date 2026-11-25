import Base

type FilePage is Data:
  Reload{}
  End{text: Nat}
  More{text: Nat, offset: Nat}

# The reader checks the cursor revision before reading and rechecks the file after reading.
# Bytes held by the UTF-8 decoder are excluded from the consumed count.
def page(same_revision: Bool, stable_read: Bool, has_more: Bool, text: Nat, start: Nat, consumed: Nat) -> FilePage:
  match same_revision:
    case False{}: Reload{}
    case True{}:
      match stable_read:
        case False{}: Reload{}
        case True{}:
          match has_more:
            case False{}: End{text}
            case True{}: More{text, (start + consumed : Nat)}

law stale_cursor_requires_reload:
  for stable_read: Bool
  for has_more: Bool
  for text: Nat
  for start: Nat
  for consumed: Nat
  {page(False{}, stable_read, has_more, text, start, consumed) == Reload{} : FilePage}

law changed_read_requires_reload:
  for has_more: Bool
  for text: Nat
  for start: Nat
  for consumed: Nat
  {page(True{}, False{}, has_more, text, start, consumed) == Reload{} : FilePage}

law next_page_starts_after_consumed_bytes:
  for text: Nat
  for start: Nat
  for consumed: Nat
  {page(True{}, True{}, True{}, text, start, consumed) == More{text, (start + consumed : Nat)} : FilePage}

law end_of_file_has_no_cursor:
  for text: Nat
  for start: Nat
  for consumed: Nat
  {page(True{}, True{}, False{}, text, start, consumed) == End{text} : FilePage}
