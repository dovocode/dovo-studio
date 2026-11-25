import Base

type AnswerReason is Data:
  NoReviewReason{}
  ReviewReason{text: Nat}

type ReviewState is Data:
  PendingReview{required: Bool}
  RecordedReview{allow: Bool, reason: AnswerReason}

def record(required: Bool, reason: AnswerReason, allow: Bool) -> ReviewState:
  match required:
    case False{}: RecordedReview{allow, reason}
    case True{}:
      match reason:
        case NoReviewReason{}: PendingReview{True{}}
        case ReviewReason{text}: RecordedReview{allow, ReviewReason{text}}

def decide(state: ReviewState, current: Bool, allow: Bool, reason: AnswerReason) -> ReviewState:
  match state:
    case RecordedReview{previous, saved}: RecordedReview{previous, saved}
    case PendingReview{required}:
      match current:
        case False{}: PendingReview{required}
        case True{}: record(required, reason, allow)

law required_reason_holds_review:
  for allow: Bool
  {decide(PendingReview{True{}}, True{}, allow, NoReviewReason{}) == PendingReview{True{}} : ReviewState}

law stale_attempt_holds_review:
  for required: Bool
  for allow: Bool
  for reason: AnswerReason
  {decide(PendingReview{required}, False{}, allow, reason) == PendingReview{required} : ReviewState}

law saved_review_cannot_be_replaced:
  for allow: Bool
  for reason: Nat
  for other: Bool
  for replacement: AnswerReason
  saved = decide(PendingReview{True{}}, True{}, allow, ReviewReason{reason})
  {decide(saved, True{}, other, replacement) == RecordedReview{allow, ReviewReason{reason}} : ReviewState}
