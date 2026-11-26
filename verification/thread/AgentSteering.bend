import Base

type Delivery is Data:
  Acknowledged{}
  Queued{}
  Steered{}

# Only a ready native turn can take an agent's new input ahead of its next turn.
def deliver(accepted: Bool, ready: Bool, paused: Bool, earlier: Bool) -> Delivery:
  match accepted:
    case True{}: Acknowledged{}
    case False{}:
      match ready:
        case False{}: Queued{}
        case True{}:
          match paused:
            case True{}: Queued{}
            case False{}:
              match earlier:
                case True{}: Queued{}
                case False{}: Steered{}

law retry_acknowledges_existing_message:
  for ready: Bool
  for paused: Bool
  for earlier: Bool
  {deliver(True{}, ready, paused, earlier) == Acknowledged{} : Delivery}

law paused_queue_holds_agent_input:
  for ready: Bool
  for earlier: Bool
  {deliver(False{}, ready, True{}, earlier) == Queued{} : Delivery}

law earlier_input_keeps_its_order:
  for ready: Bool
  for paused: Bool
  {deliver(False{}, ready, paused, True{}) == Queued{} : Delivery}

law unavailable_native_turn_queues_input:
  for paused: Bool
  for earlier: Bool
  {deliver(False{}, False{}, paused, earlier) == Queued{} : Delivery}

law ready_native_turn_takes_unqueued_input:
  {deliver(False{}, True{}, False{}, False{}) == Steered{} : Delivery}
