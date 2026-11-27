namespace Dovo.MobileThread

structure Draft where
  text : String
  editedAfterStage : Bool
  accepted : Bool

def confirmFork (draft : Draft) (submitted : String) : Draft :=
  { draft with
    accepted := true
    text := if !draft.accepted && !draft.editedAfterStage && draft.text == submitted
            then "" else draft.text }

theorem confirmationPreservesAnEditedDraft {draft : Draft} (edited : draft.editedAfterStage = true)
    (submitted : String) : (confirmFork draft submitted).text = draft.text := by
  simp [confirmFork, edited]

theorem matchingUneditedDraftClears (submitted : String) :
    (confirmFork ⟨submitted, false, false⟩ submitted).text = "" := by
  simp [confirmFork]

theorem acceptingAgainKeepsNewInput (draft : Draft) (submitted : String) :
    confirmFork (confirmFork draft submitted) submitted = confirmFork draft submitted := by
  simp [confirmFork]

structure HistoryScope where
  computer : Nat
  thread : Nat
  revision : Nat
  deriving DecidableEq

def canPublishHistory (requested current : HistoryScope) : Bool :=
  decide (requested = current)

theorem staleScopeCannotPublish {requested current : HistoryScope} (stale : requested ≠ current) :
    canPublishHistory requested current = false := by
  simp [canPublishHistory, stale]

end Dovo.MobileThread
