import Base

type Tab is Type:
  LinkPreview{page: Nat}
  RegularBrowserTab{page: Nat}
  BrowserTabClosed{}

type OpenerLoss is Type:
  OpenerClosed{}
  OpenerEvicted{}

def promote(tab: Tab) -> Tab:
  match tab:
    case LinkPreview{page}: RegularBrowserTab{page}
    case RegularBrowserTab{page}: RegularBrowserTab{page}
    case BrowserTabClosed{}: BrowserTabClosed{}

def lose_opener(outlives_opener: Bool, reason: OpenerLoss, tab: Tab) -> Tab:
  match outlives_opener:
    case True{}: tab
    case False{}: BrowserTabClosed{}

def dismiss_preview(tab: Tab) -> Tab:
  match tab:
    case LinkPreview{page}: BrowserTabClosed{}
    case RegularBrowserTab{page}: RegularBrowserTab{page}
    case BrowserTabClosed{}: BrowserTabClosed{}

law opener_loss_keeps_the_promoted_page:
  for page: Nat
  for reason: OpenerLoss
  {lose_opener(True{}, reason, promote(LinkPreview{page})) == RegularBrowserTab{page} : Tab}

law old_electron_default_closes_the_promoted_page:
  for page: Nat
  for reason: OpenerLoss
  {lose_opener(False{}, reason, promote(LinkPreview{page})) == BrowserTabClosed{} : Tab}

law studio_can_still_dismiss_a_preview:
  for page: Nat
  {dismiss_preview(LinkPreview{page}) == BrowserTabClosed{} : Tab}

law studio_preview_cleanup_leaves_a_promoted_tab_open:
  for page: Nat
  {dismiss_preview(promote(LinkPreview{page})) == RegularBrowserTab{page} : Tab}
