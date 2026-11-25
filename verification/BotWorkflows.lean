import Lean

namespace Dovo.BotWorkflows

inductive ActivityKind where
  | conversation | audit | artifact
  deriving DecidableEq, Lean.ToJson

inductive ActivityOwner where
  | bot | archive
  deriving DecidableEq, Lean.ToJson

def archiveOwner : ActivityKind → ActivityOwner
  | .conversation => .archive
  | .audit | .artifact => .bot

def visibleAfterArchive (event cutoff : Nat) : Bool := decide (cutoff < event)

theorem conversationMovesToArchive : archiveOwner .conversation = .archive := rfl

theorem unrelatedActivityStays : archiveOwner .audit = .bot ∧ archiveOwner .artifact = .bot :=
  ⟨rfl, rfl⟩

theorem staleActivityIsHidden (event cutoff : Nat) (stale : event ≤ cutoff) :
    visibleAfterArchive event cutoff = false := by
  simp [visibleAfterArchive, Nat.not_lt.mpr stale]

theorem newActivityIsVisible (event cutoff : Nat) (fresh : cutoff < event) :
    visibleAfterArchive event cutoff = true := by
  simp [visibleAfterArchive, fresh]

structure PluginRequest where
  writable : Bool := true
  activeBefore : Bool := true
  activeAtInstall : Bool := true
  activate : Bool := false
  reviewedRevisionMatches : Bool := true
  approved : Bool := true
  currentRevisionMatches : Bool := true
  deriving Lean.ToJson

def needsApproval (request : PluginRequest) : Bool :=
  request.writable && request.activeBefore && !request.activate && request.reviewedRevisionMatches

def installPlugin (request : PluginRequest) : Bool :=
  needsApproval request && request.activeAtInstall && request.approved && request.currentRevisionMatches

theorem installedPluginWasApproved (request : PluginRequest)
    (installed : installPlugin request = true) :
    request.approved = true ∧ request.currentRevisionMatches = true := by
  simp [installPlugin, Bool.and_eq_true] at installed
  exact ⟨installed.1.2, installed.2⟩

theorem installedPluginIsInactive (request : PluginRequest)
    (installed : installPlugin request = true) : request.activate = false := by
  simp [installPlugin, needsApproval, Bool.and_eq_true] at installed
  exact installed.1.1.1.1.2

theorem installedPluginHasWritableActiveRun (request : PluginRequest)
    (installed : installPlugin request = true) :
    request.writable = true ∧ request.activeBefore = true ∧ request.activeAtInstall = true := by
  simp [installPlugin, needsApproval, Bool.and_eq_true] at installed
  exact ⟨installed.1.1.1.1.1.1, installed.1.1.1.1.1.2, installed.1.1.2⟩

inductive Parent where
  | running | finalizing | finished
  deriving DecidableEq, Lean.ToJson

inductive Child where
  | none | working | pending | background | finished
  deriving DecidableEq, Lean.ToJson

def workingSince (parent : Parent) (child : Child) (startedAt : Option Nat) : Option Nat :=
  match parent, child with
  | .running, _ | .finished, .working | .finished, .pending => startedAt
  | _, _ => none

theorem waitingKeepsParentStart (startedAt : Option Nat) :
    workingSince .finished .working startedAt = startedAt ∧
    workingSince .finished .pending startedAt = startedAt := ⟨rfl, rfl⟩

theorem backgroundAndFinishedChildrenDoNotTick (startedAt : Option Nat) :
    workingSince .finished .background startedAt = none ∧
    workingSince .finished .finished startedAt = none := ⟨rfl, rfl⟩

def renderCases : String :=
  let archiveCases := [ActivityKind.conversation, .audit, .artifact].flatMap fun kind =>
    [0, 1, 2].map fun time => Lean.Json.mkObj [
      ("kind", Lean.toJson "archive"), ("activity", Lean.toJson kind), ("time", Lean.toJson time),
      ("owner", Lean.toJson (archiveOwner kind)), ("visible", Lean.toJson (visibleAfterArchive time 1))]
  let pluginInputs : List PluginRequest := [
    { writable := false }, { activeBefore := false }, { activeAtInstall := false },
    { activate := true }, { reviewedRevisionMatches := false }, { approved := false },
    { currentRevisionMatches := false }, {}]
  let pluginCases := pluginInputs.map fun input => Lean.Json.mkObj [
    ("kind", Lean.toJson "plugin"), ("input", Lean.toJson input),
    ("needsApproval", Lean.toJson (needsApproval input)),
    ("installed", Lean.toJson (installPlugin input))]
  let timerCases := [Parent.running, .finalizing, .finished].flatMap fun parent =>
    [Child.none, .working, .pending, .background, .finished].flatMap fun child =>
      [none, some 1].map fun startedAt => Lean.Json.mkObj [
        ("kind", Lean.toJson "timer"), ("parent", Lean.toJson parent),
        ("child", Lean.toJson child), ("startedAt", Lean.toJson startedAt),
        ("workingSince", Lean.toJson (workingSince parent child startedAt))]
  String.intercalate "\n" ((archiveCases ++ pluginCases ++ timerCases).map Lean.Json.compress)

end Dovo.BotWorkflows

def main : IO Unit := IO.println Dovo.BotWorkflows.renderCases
