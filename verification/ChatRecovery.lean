import Std

namespace Dovo.ChatRecovery

namespace QueueRestore

structure Composer where
  text : List String
  attachments : List Nat
  settings : Nat
  plan : Bool

structure QueuedMessage where
  id : Nat
  text : String
  attachments : List Nat
  settings : Nat
  plan : Bool
  deriving DecidableEq

structure Request where
  fingerprint : Nat
  expectedMessage : QueuedMessage
  expectedDraftSettings : Nat
  expectedPlan : Option Bool
  expectedDraftPlan : Option Bool

structure State where
  draft : Composer
  queued : Option QueuedMessage
  -- One restore request ID, with its fingerprint recorded on commit.
  receipt : Option Nat

def PlanMatches (request : Request) (draftPlan queuedPlan : Bool) : Prop :=
  (request.expectedPlan = none ∨ request.expectedPlan = some queuedPlan) ∧
  (request.expectedDraftPlan = none ∨ request.expectedDraftPlan = some draftPlan) ∧
  ((request.expectedPlan = none ∨ request.expectedDraftPlan = none) → queuedPlan = draftPlan)

def Composer.hasContent (draft : Composer) : Prop :=
  draft.text ≠ [] ∨ draft.attachments ≠ []

def mergedAttachments (draft : Composer) (message : QueuedMessage) : List Nat :=
  (draft.attachments ++ message.attachments).eraseDups

def restoreDraft (draft : Composer) (message : QueuedMessage) : Composer :=
  ⟨draft.text ++ [message.text], mergedAttachments draft message, message.settings, message.plan⟩

inductive Restore : State → Request → State → Prop where
  | apply {before : State} {request : Request} {message : QueuedMessage}
      (unused : before.receipt = none)
      (queued : before.queued = some message)
      (observed : request.expectedMessage = message)
      (settingsCurrent : request.expectedDraftSettings = before.draft.settings)
      (planCurrent : PlanMatches request before.draft.plan message.plan)
      (compatible : before.draft.hasContent →
        message.settings = before.draft.settings ∧ message.plan = before.draft.plan)
      (withinLimit : (mergedAttachments before.draft message).length ≤ 5) :
      Restore before request ⟨restoreDraft before.draft message, none, some request.fingerprint⟩
  | replay {state : State} {request : Request}
      (saved : state.receipt = some request.fingerprint) :
      Restore state request state

theorem recordedRestorePreservesCurrentDraft {before after : State} {request : Request}
    {saved : Nat} (recorded : before.receipt = some saved)
    (transition : Restore before request after) :
    after = before ∧ request.fingerprint = saved := by
  cases transition with
  | apply unused => cases recorded.symm.trans unused
  | replay matched => exact ⟨rfl, Option.some.inj (matched.symm.trans recorded)⟩

theorem staleModelChoiceCannotRestore {before after : State} {request : Request}
    (unused : before.receipt = none)
    (stale : request.expectedDraftSettings ≠ before.draft.settings) :
    ¬ Restore before request after := by
  intro transition
  cases transition with
  | apply _ _ _ current => exact stale current
  | replay saved => cases unused.symm.trans saved

theorem populatedDraftKeepsModel {before after : State} {request : Request}
    (populated : before.draft.hasContent) (transition : Restore before request after) :
    after.draft.settings = before.draft.settings := by
  cases transition with
  | apply _ _ _ _ _ compatible => exact (compatible populated).1
  | replay => rfl

theorem legacyRestoreKeepsPlan {before after : State} {request : Request}
    (omitted : request.expectedPlan = none ∨ request.expectedDraftPlan = none)
    (transition : Restore before request after) :
    after.draft.plan = before.draft.plan := by
  cases transition with
  | apply _ _ _ _ validPlan => exact validPlan.2.2 omitted
  | replay => rfl

theorem restoreKeepsExistingTextAndBoundsFiles {before after : State} {request : Request}
    (unused : before.receipt = none) (transition : Restore before request after) :
    after.draft.text = before.draft.text ++ [request.expectedMessage.text] ∧
    after.draft.attachments.length ≤ 5 ∧ after.queued = none := by
  cases transition with
  | apply _ _ observed _ _ _ withinLimit =>
      exact ⟨by simp [restoreDraft, observed], withinLimit, rfl⟩
  | replay saved => cases unused.symm.trans saved

end QueueRestore

namespace ThreadStartOutbox

structure Cursor where
  runtimeInstance : Nat
  revision : Nat

inductive ThreadEvidence where
  | matchingMessage
  | presentWithoutMessage
  | absent (scopeProvesAbsence : Bool)

structure Snapshot where
  cached : Bool
  cursor : Cursor
  thread : ThreadEvidence

def canSettle (acknowledgement : Option Cursor) (snapshot : Snapshot) : Bool :=
  snapshot.cached &&
    match snapshot.thread with
    | .matchingMessage => true
    | .presentWithoutMessage => false
    | .absent scopeProvesAbsence =>
        match acknowledgement with
        | none => false
        | some ack =>
            decide (snapshot.cursor.runtimeInstance = ack.runtimeInstance ∧
              ack.revision ≤ snapshot.cursor.revision) && scopeProvesAbsence

theorem unsavedSnapshotCannotSettle {snapshot : Snapshot} {ack : Option Cursor}
    (unsaved : snapshot.cached = false) : canSettle ack snapshot = false := by
  simp [canSettle, unsaved]

theorem incompletePageCannotSettleAbsence {snapshot : Snapshot} {ack : Option Cursor}
    (missingEvidence : snapshot.thread = .absent false) : canSettle ack snapshot = false := by
  cases ack <;> simp [canSettle, missingEvidence]

theorem cachedMessageSettles {snapshot : Snapshot} {ack : Option Cursor}
    (cached : snapshot.cached = true) (found : snapshot.thread = .matchingMessage) :
    canSettle ack snapshot = true := by
  simp [canSettle, cached, found]

theorem cachedThreadWithoutMessageCannotSettle {snapshot : Snapshot} {ack : Option Cursor}
    (missing : snapshot.thread = .presentWithoutMessage) : canSettle ack snapshot = false := by
  simp [canSettle, missing]

theorem absentThreadNeedsMatchingCursor {snapshot : Snapshot} {ack : Option Cursor}
    {complete : Bool} (absent : snapshot.thread = .absent complete)
    (settled : canSettle ack snapshot = true) :
    ∃ cursor, ack = some cursor ∧ snapshot.cursor.runtimeInstance = cursor.runtimeInstance ∧
      cursor.revision ≤ snapshot.cursor.revision := by
  cases ack with
  | none => simp [canSettle, absent] at settled
  | some cursor =>
      simp [canSettle, absent, Bool.and_eq_true] at settled
      exact ⟨cursor, rfl, settled.2.1.1, settled.2.1.2⟩

end ThreadStartOutbox

namespace QueuedModels

structure Choice where
  model : Nat
  matchesHarness : Bool

structure Thread where
  defaultModel : Nat
  activeModel : Option Nat
  queuedChoice : Option Choice

def changeQueuedChoice (thread : Thread) (choice : Option Choice) : Thread :=
  { thread with queuedChoice := choice }

def startNextTurn (thread : Thread) : Option Thread :=
  if thread.activeModel.isSome then none
  else
    let model := match thread.queuedChoice with
      | some choice => if choice.matchesHarness then choice.model else thread.defaultModel
      | none => thread.defaultModel
    some ⟨model, some model, none⟩

theorem changingQueuedChoicePreservesActiveModelAndDefault (thread : Thread)
    (choice : Option Choice) :
    (changeQueuedChoice thread choice).activeModel = thread.activeModel ∧
      (changeQueuedChoice thread choice).defaultModel = thread.defaultModel :=
  ⟨rfl, rfl⟩

theorem compatibleQueuedChoiceBecomesDefaultAtStart {thread : Thread} {choice : Choice}
    (idle : thread.activeModel = none) (queued : thread.queuedChoice = some choice)
    (compatible : choice.matchesHarness = true) :
    startNextTurn thread = some ⟨choice.model, some choice.model, none⟩ := by
  simp [startNextTurn, idle, queued, compatible]

theorem incompatibleQueuedChoiceKeepsDefault {thread : Thread} {choice : Choice}
    (idle : thread.activeModel = none) (queued : thread.queuedChoice = some choice)
    (incompatible : choice.matchesHarness = false) :
    startNextTurn thread = some ⟨thread.defaultModel, some thread.defaultModel, none⟩ := by
  simp [startNextTurn, idle, queued, incompatible]

end QueuedModels

end Dovo.ChatRecovery
