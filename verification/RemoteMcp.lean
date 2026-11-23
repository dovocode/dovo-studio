import Lean

namespace Dovo.RemoteMcp

structure Grant where
  active : Bool
  boundResource : Bool
  boundInstallation : Bool
  hostEnabled : Bool
  allowsWrite : Bool

def admits (grant : Grant) (writes : Bool) : Bool :=
  grant.active && grant.boundResource && grant.boundInstallation && grant.hostEnabled &&
    (!writes || grant.allowsWrite)

theorem revokedCannotAdmit (grant : Grant) (writes : Bool) (revoked : grant.active = false) :
    admits grant writes = false := by simp [admits, revoked]

theorem replacedInstallationCannotAdmit (grant : Grant) (writes : Bool)
    (replaced : grant.boundInstallation = false) :
    admits grant writes = false := by simp [admits, replaced]

theorem otherResourceCannotAdmit (grant : Grant) (writes : Bool)
    (other : grant.boundResource = false) :
    admits grant writes = false := by simp [admits, other]

theorem readGrantCannotWrite (grant : Grant) (readOnly : grant.allowsWrite = false) :
    admits grant true = false := by simp [admits, readOnly]

def effectivePermission (configured _requested : Nat) : Nat := configured

theorem permissionUsesSavedSettings (configured requested : Nat) :
    effectivePermission configured requested = configured := rfl

inductive Receipt where | absent | saved | uncertain
  deriving DecidableEq, Lean.ToJson

def launch (grant : Grant) (receipt : Receipt) : Receipt × Nat :=
  if !admits grant true then (receipt, 0)
  else match receipt with
    | .absent => (.saved, 1)
    | .saved => (.saved, 0)
    | .uncertain => (.uncertain, 0)

theorem retryNeverLaunchesTwice (grant : Grant) (receipt : Receipt)
    (recorded : receipt ≠ .absent) : (launch grant receipt).2 = 0 := by
  cases receipt <;> simp_all [launch] <;> split <;> simp_all

theorem originalAndRetryAtMostOneLaunch (grant retryGrant : Grant) :
    (launch grant .absent).2 + (launch retryGrant (launch grant .absent).1).2 ≤ 1 := by
  unfold launch
  split <;> split <;> simp_all <;> split <;> simp_all

structure Input where
  active : Bool
  boundResource : Bool
  boundInstallation : Bool
  hostEnabled : Bool
  allowsWrite : Bool
  writes : Bool
  deriving Lean.ToJson

def renderCases : String :=
  let flags := [false, true]
  let cases := flags.flatMap fun active => flags.flatMap fun resource =>
    flags.flatMap fun installation => flags.flatMap fun enabled =>
    flags.flatMap fun allowsWrite => flags.map fun writes =>
      { active, boundResource := resource, boundInstallation := installation,
        hostEnabled := enabled, allowsWrite, writes : Input }
  String.intercalate "\n" (cases.map fun input =>
    let grant : Grant := {
      active := input.active
      boundResource := input.boundResource
      boundInstallation := input.boundInstallation
      hostEnabled := input.hostEnabled
      allowsWrite := input.allowsWrite
    }
    (Lean.Json.mkObj [("input", Lean.toJson input), ("admitted", Lean.toJson (admits grant input.writes))]).compress)

end Dovo.RemoteMcp

def main : IO Unit := IO.println Dovo.RemoteMcp.renderCases
