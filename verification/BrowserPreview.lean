namespace Dovo.BrowserPreview

inductive Tab where
  | preview (page : Nat)
  | regular (page : Nat)
  | closed
  deriving DecidableEq

inductive OpenerLoss where
  | close
  | evictIdlePage

def promote : Tab → Tab
  | .preview page => .regular page
  | tab => tab

/-- Electron applies this flag when it adopts the Chromium child. -/
def loseOpener (outlivesOpener : Bool) (_ : OpenerLoss) (tab : Tab) : Tab :=
  if outlivesOpener then tab else .closed

/-- Studio can still dismiss a preview when it leaves the active preview chain. -/
def dismissPreview : Tab → Tab
  | .preview _ => .closed
  | tab => tab

theorem promotionRetainsPage (page : Nat) :
    promote (.preview page) = .regular page := rfl

theorem openerLossRetainsPromotedPage (page : Nat) (reason : OpenerLoss) :
    loseOpener true reason (promote (.preview page)) = .regular page := rfl

theorem oldElectronDefaultClosesPromotedPage (page : Nat) (reason : OpenerLoss) :
    loseOpener false reason (promote (.preview page)) = .closed := rfl

theorem studioDismissesOnlyPreviews (page : Nat) :
    dismissPreview (.preview page) = .closed ∧
    dismissPreview (promote (.preview page)) = .regular page := ⟨rfl, rfl⟩

end Dovo.BrowserPreview
