import Base

type LinkedPage is Data:
  Withheld{}
  Published{body: Nat}

def publish_linked(same_target: Bool, active_link: Bool, same_generation: Bool, body: Nat) -> LinkedPage:
  match same_target:
    case False{}: Withheld{}
    case True{}:
      match active_link:
        case False{}: Withheld{}
        case True{}:
          match same_generation:
            case False{}: Withheld{}
            case True{}: Published{body}

# Check the reader and peer pairings again after receiving the page.
def publish(reader_paired: Bool, peer_paired: Bool, same_target: Bool, active_link: Bool, same_generation: Bool, body: Nat) -> LinkedPage:
  match reader_paired:
    case False{}: Withheld{}
    case True{}:
      match peer_paired:
        case False{}: Withheld{}
        case True{}: publish_linked(same_target, active_link, same_generation, body)

law a_different_thread_cannot_publish:
  for active_link: Bool
  for same_generation: Bool
  for body: Nat
  {publish(True{}, True{}, False{}, active_link, same_generation, body) == Withheld{} : LinkedPage}

law unlink_discards_in_flight_read:
  for body: Nat
  {publish(True{}, True{}, True{}, False{}, True{}, body) == Withheld{} : LinkedPage}

law relink_cannot_publish_an_old_read:
  for body: Nat
  {publish(True{}, True{}, True{}, True{}, False{}, body) == Withheld{} : LinkedPage}

law revoked_reader_cannot_receive_in_flight_read:
  for body: Nat
  {publish(False{}, True{}, True{}, True{}, True{}, body) == Withheld{} : LinkedPage}

law unpaired_peer_cannot_publish_in_flight_read:
  for body: Nat
  {publish(True{}, False{}, True{}, True{}, True{}, body) == Withheld{} : LinkedPage}

law verified_link_publishes_read:
  for body: Nat
  {publish(True{}, True{}, True{}, True{}, True{}, body) == Published{body} : LinkedPage}
