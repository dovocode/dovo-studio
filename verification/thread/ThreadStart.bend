import Base

type StartAdmission is Type:
  CreateStart{}
  ReplayStart{}
  RejectStart{}

# Existing records compare the request against the stored bootstrap identity.
def admit_start(deleted: Bool, present: Bool, same: Bool) -> StartAdmission:
  match deleted:
    case True{}: RejectStart{}
    case False{}:
      match present:
        case False{}: CreateStart{}
        case True{}:
          match same:
            case True{}: ReplayStart{}
            case False{}: RejectStart{}

def side_may_commit(parent_available: Bool, snapshot: Bool, parent_busy: Bool) -> Bool:
  match parent_available:
    case False{}: False{}
    case True{}:
      match snapshot:
        case False{}: True{}
        case True{}:
          match parent_busy:
            case True{}: False{}
            case False{}: True{}

def child_may_start(parent_live: Bool, same_run: Bool) -> Bool:
  match parent_live:
    case False{}: False{}
    case True{}: same_run

law new_start_creates_one_draft:
  for same: Bool
  {admit_start(False{}, False{}, same) == CreateStart{} : StartAdmission}

law matching_start_replays:
  {admit_start(False{}, True{}, True{}) == ReplayStart{} : StartAdmission}

law different_start_rejects:
  {admit_start(False{}, True{}, False{}) == RejectStart{} : StartAdmission}

law deleted_start_cannot_create:
  for present: Bool
  for same: Bool
  {admit_start(True{}, present, same) == RejectStart{} : StartAdmission}

law unavailable_parent_blocks_side_commit:
  for snapshot: Bool
  for busy: Bool
  {side_may_commit(False{}, snapshot, busy) == False{} : Bool}

law busy_parent_blocks_snapshot_commit:
  {side_may_commit(True{}, True{}, True{}) == False{} : Bool}

law busy_parent_allows_committed_context:
  {side_may_commit(True{}, False{}, True{}) == True{} : Bool}

law ended_parent_blocks_child_start:
  for same_run: Bool
  {child_may_start(False{}, same_run) == False{} : Bool}

law replaced_parent_run_blocks_child_start:
  {child_may_start(True{}, False{}) == False{} : Bool}

law live_parent_admits_its_child:
  {child_may_start(True{}, True{}) == True{} : Bool}

def fork_may_start(committed: Bool, source_available: Bool) -> Bool:
  committed

law committed_fork_can_start_after_source_deletion:
  {fork_may_start(True{}, False{}) == True{} : Bool}

def side_may_start(parent_exists: Bool, wants_write: Bool, captured_write: Bool, current_write: Bool) -> Bool:
  match parent_exists:
    case False{}: False{}
    case True{}:
      match wants_write:
        case False{}: True{}
        case True{}:
          match captured_write:
            case False{}: False{}
            case True{}: current_write

def fork_may_commit(source_available: Bool, deleted: Bool) -> Bool:
  match source_available:
    case False{}: False{}
    case True{}:
      match deleted:
        case False{}: True{}
        case True{}: False{}

law narrowed_parent_blocks_side_write:
  {side_may_start(True{}, True{}, True{}, False{}) == False{} : Bool}

law narrowed_parent_allows_side_read:
  {side_may_start(True{}, False{}, True{}, False{}) == True{} : Bool}

law deleted_fork_cannot_commit:
  for source_available: Bool
  {fork_may_commit(source_available, True{}) == False{} : Bool}

law missing_source_blocks_fork_commit:
  {fork_may_commit(False{}, False{}) == False{} : Bool}
