import Base

type LinkedPage is Data:
  Withheld{}
  Published{body: Nat}

# An active saved link has a verified target identity and an unchanged generation.
def publish(same_target: Bool, active_link: Bool, same_generation: Bool, body: Nat) -> LinkedPage:
  match same_target:
    case False{}: Withheld{}
    case True{}:
      match active_link:
        case False{}: Withheld{}
        case True{}:
          match same_generation:
            case False{}: Withheld{}
            case True{}: Published{body}

law a_different_thread_cannot_publish:
  for active_link: Bool
  for same_generation: Bool
  for body: Nat
  {publish(False{}, active_link, same_generation, body) == Withheld{} : LinkedPage}

law unlink_discards_in_flight_read:
  for body: Nat
  {publish(True{}, False{}, True{}, body) == Withheld{} : LinkedPage}

law relink_cannot_publish_an_old_read:
  for body: Nat
  {publish(True{}, True{}, False{}, body) == Withheld{} : LinkedPage}

law verified_link_publishes_read:
  for body: Nat
  {publish(True{}, True{}, True{}, body) == Published{body} : LinkedPage}
