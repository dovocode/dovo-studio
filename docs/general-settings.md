# General settings

General contains device preferences for navigation, date and time, shortcuts and background
activity. Task list & projects contains project grouping/order, task sorting, the starting folder
and task confirmations. Changes save automatically on this device. General links to task
organization, Conversation, Agents and Task defaults.

The desktop settings navigation groups **This app**, **Agents & tools**, **Tasks & projects**,
**Computers** and **History**. Categories expand and collapse to keep the sidebar compact; the
active page’s category opens automatically after navigation. Search reveals matching pages in every
category without changing which categories were open. The selected page has a readable storage
label: this device, per computer, or computer & project. Other pages keep storage details in their
tooltips to reduce visual clutter. Usage & limits spans paired computers. Browser and Pull requests
& pipelines combine device and computer preferences. Inherited pages follow the shared
project/computer target; the navigation explains the active page's storage and only shows this
target for inherited pages. Search matches categories, page names and control keywords. The narrow
section chooser retains the same categories. The scope summary is informational; scope controls stay
at the top of inherited settings pages. CLI commands, Studio Tools and Memory are under Agents &
tools; Running tasks is under Tasks & projects; Activity & message history is under History.
Existing route IDs are retained. Conversation contains composer, follow-up, response and desktop
speech preferences; Notifications contains alerts; Review & diffs contains review behavior; Updates
& about contains application and provider update preferences and notices. Titles & dictation has its
own computer-specific page.

## Mobile settings

Mobile uses a compact grouped index with the same five categories. Each category opens a dedicated
page with smaller groups such as Look & feel, Chat & voice, Task workflow and Files & outputs. Back
navigation returns from a setting to its category, then to the index. The Settings tab root has no
redundant back button. Memory lives with agent tools. Global search jumps directly to any setting;
category search stays within that category. Clearing search restores the index or category. Storage
details appear on the destination page instead of repeating computer names in the index.
Conversation, Speech & driving, Notifications, and Battery & background have direct entries and save
on the phone. Task & PR preferences controls the phone's task list, confirmations and merge
defaults; Task defaults uses the shared computer/project scope.

Task behavior, Pull requests & pipelines, Artifacts, Memory, Worktrees, Runtime tools, and Activity
retention open focused pages with a computer selector. Changes save on the named computer and are
shared with its other paired devices. Manage computers still provides the existing connection and
runtime controls. Settings search includes the controls on the focused pages.

The mobile model picker has a full-width provider chooser. Opening or filtering providers does not
change the selected model; choosing a model commits the change. The chooser and model list share the
surrounding sheet’s scroll area, and saved favorites stay with their computer.

## Task defaults

The runtime selects initial agent and title models automatically before publishing its connection.
If Codex is installed and available through the configured command, new tasks use the latest visible
Sol model at medium reasoning, and titles/dictation use the latest Luna model at low reasoning. The
installed Codex catalogue determines the versions; if discovery fails, the bundled defaults are
GPT-6.1-Sol and GPT-6-Luna. Otherwise, Claude uses its latest `opus` alias at medium effort for
tasks and latest `sonnet` alias at low effort for titles/dictation. Provider installation and
authentication still use the host’s existing setup. Explicit task defaults and saved title choices
are preserved, including choices made while discovery is pending. You can change the defaults on
these settings pages without completing a first-run wizard.

Task defaults contains new-task launch and workspace defaults, saved prompts and lifecycle policy.
Its **Applying settings for** bar shows **Global → Computer → Project → Project on computer** and
stays visible while the page scrolls. Each control shows where its value comes from, offers Reset
when an override is present, and counts later levels that override it with a way to open or reset
them. Shared layers synchronize to paired computers; a shared project uses its canonical Git remote
identity. An unset value inherits the earlier layers. Selecting **Off** explicitly overrides an
inherited **On**. Local folders use the checkout-specific computer scope. Switching scope or leaving
an edited settings page asks before discarding unsaved changes.

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

On Windows and Linux, the desktop app's native window controls and title strip follow the selected
palette and light or dark mode, including **System** changes. The last palette is remembered so the
window opens in the right colours before the app has rendered.

The app preference pages expose project grouping/order, Working, in-app alerts, completed-paragraph
streaming, slash-menu skills, rendered Markdown composer preview, composer collapse while reading
older messages, whitespace-only file filtering, proactive review panels, starting folder,
provider-version checks and desktop quit-shortcut controls. `$` still finds skills when slash-menu
skills are disabled. The composer stores and sends plain Markdown.

Reduced background activity slows overview refreshes to two minutes. Balanced keeps the existing
30-second visible-window cadence; input preview retains its faster refresh. Provider diagnostics
inspect the selected computer; SDK updates remain part of Dovo updates. The native quit menu remains
available when the shortcut is disabled. Hold mode waits 600 ms or accepts two presses within 500
ms.

Agents & tools includes the per-computer Titles & dictation editor. Version and release-track
controls use the existing desktop update bridge. Mobile-specific driving, speech, widgets and
battery preferences retain their native settings. Mobile task defaults can edit scoped lifecycle
policy, and quota continuations can be cancelled on either client.

## Desktop speech

Conversation → Speech provides an explicit download for the 751 MB Nemotron model, progress,
cancellation and retry. Downloading enables the composer microphone; the enable toggle can hide it
without removing the model. The language picker supports automatic detection and 32 locales,
including Dutch and English. Recording shows a live preview and runs locally on the desktop CPU.
These settings are local app preferences; they do not change native mobile speech recognition or
runtime models.
