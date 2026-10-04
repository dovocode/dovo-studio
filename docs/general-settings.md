# General settings

General combines scoped task defaults and lifecycle policy with grouped app preferences.

The target selector edits one inheritance layer: **Global → Environment → Project → Environment +
project**. Shared layers synchronize to paired computers; a shared project uses its canonical Git
remote identity. An unset value inherits the earlier layers. Selecting **Off** explicitly overrides
an inherited **On**. Local folders use the checkout-specific environment scope. Device preferences
are labeled separately and stay on the device.

## Lifecycle

- Quota resume and snooze are opt-in. A failed turn must report a quota error and exhausted usage
  windows with future reset times. Dovo waits for the latest exhausted window's reset. It never
  guesses a date or retries an unrelated failure. The task displays its continuation and offers
  Cancel on desktop and mobile. Manual wake, settle, archive and a new run cancel it.
- At the reset, Dovo checks the current policy and failed turn again. New queued input, delegated
  tasks and automation-owned tasks cannot be resumed by this scheduler. Admission is attempted once;
  failure is recorded in Activity and requires manual continuation.
- Inactive settling runs during upkeep (every 15 minutes). The default threshold is 3 days,
  configurable from 1 to 365. It protects task families with pins, running work, waiting input,
  terminals, drafts, queued messages and scheduled work. Settled tasks keep their worktrees and
  history. Settling is separate from the existing per-computer automatic archival policy.
- PR merge and close settling can be overridden independently. Existing computer settings remain the
  fallback when no scoped override exists. Automatic PR archival still takes precedence over
  settling. Restart continuation uses scoped policy with the existing computer restart preference as
  its fallback.

Lifecycle policies apply to existing tasks. Checkout defaults apply to new tasks. Submodules can
remain uninitialized, initialize directly, or initialize recursively before worktree setup. Older
runtimes must update before scoped lifecycle controls become editable.

## App preferences

General exposes organization, notifications, conversation, diffs, confirmations and updates. New
behavior includes project grouping/order, Working, in-app alerts, completed-paragraph streaming,
slash-menu skills, rendered Markdown composer preview, composer collapse while reading older
messages, whitespace-only file filtering, proactive review panels, starting folder, provider-version
checks and desktop quit-shortcut controls. `$` still finds skills when slash-menu skills are
disabled. The composer stores and sends plain Markdown.

Reduced background activity slows overview refreshes to two minutes. Balanced keeps the existing
30-second visible-window cadence; input preview retains its faster refresh. Provider diagnostics
inspect the selected computer; SDK updates remain part of Dovo updates. The native quit menu remains
available when the shortcut is disabled. Hold mode waits 600 ms or accepts two presses within 500
ms.

Text generation links to the existing per-computer Titles & dictation editor. Version and
release-track controls use the existing desktop update bridge. Mobile-specific driving, speech,
widgets and battery preferences retain their native settings. Mobile task defaults can edit scoped
lifecycle policy, and quota continuations can be cancelled on either client.
