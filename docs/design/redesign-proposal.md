# Dovo Studio redesign proposal

**Status: implemented layout and interaction pass — 20 September 2026.** See the
[implementation and verification record](redesign-implementation.md) for delivered changes, checks
and remaining limits. The companion mockups remain conceptual references. Existing runtime, provider
and task capabilities remain the boundary of this redesign; native navigation-stack migration is
still a separate change.

The goal is to make three things immediately clear: **where work runs, what needs attention, and
what action comes next**. Use a consistent hierarchy: context, title and state, content, then
secondary details. Preserve compact threads, a dedicated Issues destination, and grouped
Chat/Changes/Terminal controls.

## Problems addressed

The desktop and native screen audit found recurring hierarchy problems:

- The desktop rail uses identical icons for Tasks/Issues and Pipelines/Jobs, relying on hover
  labels.
- Computer identity repeats in the shell, selector and footer; Overview adds another device filter.
- Overview puts large metrics and computer cards above actionable threads.
- PR details retain collection filters, another toolbar and a tall summary before their content.
- A failed pipeline's metadata fills almost its first viewport; failed steps appear below it.
- Issues place integration instructions and a large task-creation panel before the description.
- Automations expose three toolbar rows and competing Run/Create task drafts buttons.
- Mobile folder controls occupy much of the sheet before the directory list begins.

Current verification captures include [Tasks](../../work/verification/primary-tasks.png),
[Overview](../../work/verification/primary-overview.png),
[Automations](../../work/verification/primary-automations.png),
[Issues](../../work/verification/work-desktop.png) and
[failed pipeline details](../../work/verification/pipeline-desktop-failed.png). The relevant
implementation is in [the shell](../../packages/studio-shell/src/workbench.tsx),
[task rows](../../packages/extension-tasks/src/task-row.tsx),
[PR details](../../packages/extension-scm/src/pulls/detail.tsx),
[pipeline details](../../packages/extension-scm/src/pipeline-detail.tsx) and
[mobile navigation](../../apps/mobile/src/shell/workbench.tsx).

## Navigation and scope

Desktop gets a collapsible, labeled sidebar: **Overview, Tasks, Issues, PRs, Pipelines,
Automations**. Settings sits at the bottom, with help and the walkthrough subordinate to daily work.
Rename the current Jobs destination to Automations; pipeline jobs keep their existing meaning.

Mobile keeps five native tabs: **Tasks, Issues, PRs, Automations, Settings**. PRs and Pipelines
remain sibling views inside PRs; their switch appears at the collection level. Preserve each tab's
selected item, filters and reading position. Keep cross-device overview accessible from the computer
selector.

**Feed scope and execution host are separate concepts.** “All computers” filters aggregate work; it
never identifies where a command will execute. Opening a task selects its owning computer. New work
shows an explicit “Run on” computer and project before sending. Project/source operations use that
project's host and configured account. Runtime or project changes clear incompatible details.

## Screen hierarchy

| Screen      | Content order                                                                   | Main action                                  |
| ----------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| Overview    | Needs input and failures, working tasks, recent outcomes; computer health below | Open the work needing attention              |
| Tasks       | Search and scope, compact threads, selected workspace                           | New task                                     |
| Chat        | Task identity/state, conversation, concise activity, composer                   | Send, Queue/Steer or Stop according to state |
| Changes     | Selected file, diff, review feedback; history and file navigation nearby        | Review or save the current edit              |
| Terminal    | Session selector, terminal output, connection state                             | Open a session when none exists              |
| Issues      | Title/state, description, discussion, linked work                               | Start task or open linked task               |
| PRs         | Title/state, readiness, Overview/Files/Activity/Checks                          | Review; mutations remain explicit actions    |
| Pipelines   | Result/duration/branch, jobs and failed steps, secondary run details            | Investigate a failed run                     |
| Automations | Name/trigger, current or latest run, steps/canvas                               | Run automation                               |
| Settings    | Computer identity, clearly named configuration destinations                     | Configure the selected item                  |

Collection controls stay with their lists. Detail headers have one prominent action, compact source
context and an overflow menu for secondary operations. Desktop may keep a narrow list beside the
detail; mobile uses one clear back header. Preserve full provider details without making every
timestamp, identifier or instruction equally prominent.

## Tasks and composer behavior

Preserve the user's three-line thread structure: **project → title → branch/device/agent**. Make the
title visually dominant, retain compact spacing, and show state separately from elapsed time.
“Finished · 4m ago” must not become an unexplained “4m ago.” Device/offline context remains
available. Use the project icon beside its name and recognizable device/harness icons with
accessible labels. Pin, snooze and settle remain available from the context menu; hover reveals
additional details without displacing the row. Offer Priority, Recent activity, Newest, Project and
Title sorts, with pinned tasks first and input requests ahead of ordinary activity in Priority mode.

Group **Chat / Changes / Terminal** in the task header, with selected states and useful counts.
Desktop supports optional splits; narrower layouts prioritize the selected surface. Mobile keeps the
grouped controls together at the top right. Summarize activity once, expanding into the existing
tools, turns and changed files when requested.

New task opens a draft chat. Model/access and local-checkout/worktree choices belong with that
draft. A task linked to an issue/run keeps its project fixed; checkout edits retain existing
first-message restrictions. Model/access cannot change during a run. Show the current access mode
with its meaning and only provider-supported choices. “Auto” means harness review, not unconditional
approval; permission requests identify the action and computer.

The composer remains one mounted input, preserving selection and keyboard focus. Idle shows
attachment, message, dictation and Send. Options expand on focus, input or first message. Stop takes
Send's position while running; Queue/Steer appear only with text or attachments. Keep Run/New out of
the composer. Pending questions own the answer form and retain Stop.

Preserve send eligibility, attachment/dictation locks, stable retry IDs and drafts until successful
submission. Only local Send/Queue/Steer requests follow the bottom; incoming work must not pull a
reader away from older messages. Hidden chats stop dictation.

## Sources, review and handoffs

Show the provider/site and project as quiet, persistent context. Jira may supply issues while a
different forge supplies PRs and pipelines. Display only supported actions, and retain notices for
partial results, stale data and unavailable provider fields. Search over loaded pages must say so
and leave pagination reachable.

PR tabs are **Overview / Files / Activity / Checks**. Activity distinguishes **discussion comments**
from **reviews**; **Approve** and **Request changes** remain explicit review actions. A comment is
not approval. Show each reviewer's latest decision and reviewed commit when provided; keep agent
permission approvals and automation review gates separate. Checks passing alone must not imply merge
readiness. Merge confirmation remains tied to the inspected revision.

Issue → task and failed run → task create editable drafts with source context and backlinks. They do
not start execution or change the source. Run SHA is context, not an automatic checkout. Related
tasks remain openable and creation retries reuse the original request. Task → PR prefills title,
source URL and branch for review before submission. PR Checks → Pipelines searches the exact head
SHA. Preserve these behaviors described in [Issues and pipelines](../issues-pipelines-jira.md).

## Automations and folders

Automations separate editing from run progress: Canvas/Steps, Runs and trigger configuration. Show
queued, running, awaiting review, finished, failed and cancelled steps, with links to their tasks.
Retry resumes the failed/cancelled run using its original configuration and completed-step history;
it is not a clean restart or rollback. Cancel stops later steps. Preserve review gates,
single-active-run protection and lost-response recovery from
[the automation contract](../automations.md).

Folder selection uses the selected computer's filesystem, including remote hosts. Give most space to
folders: title with computer subtitle, compact editable path, breadcrumbs/Home/Up, search, then the
list. Hidden folders move into an option menu. Keep “Choose this folder” fixed above the safe area.
Preserve live path navigation, keyboard controls, canonical paths and legal spaces. Loading, errors
and disconnects disable selection. Choosing a folder fills the form; adding or cloning the project
remains a separate action.

## Settings, devices and offline work

Settings keeps Agents, Projects/source control, MCP & skills, and Devices & runtime. Within device
settings, distinguish computers this client connects to from devices trusted by the current host.
Commands and activity get clear sections. Explain Disconnect, Forget and Revoke at their actions.

Keep cached content readable with last-updated/offline indicators. Partial fleet totals must not
look complete; refresh errors must not erase useful content. Commands require their owning host
online. Setup identifies host/account requirements and distinguishes automatic server pairing codes
from desktop-generated codes requiring approval. Credentials stay in their existing secure stores.

MCP/skills scope remains explicit: project defaults, agent overrides by matching name, including
disabled overrides. Explain that changes apply on the next turn. Scope changes must not redirect a
pending edit or import. Keep host-only credentials separate from ordinary client configuration.

## Visual tokens and native behavior

Use shared semantic tokens for canvas, surface, border, primary/secondary text, accent, focus and
status. Start with a 4/8/12/16/24 spacing scale, 16-point mobile gutters, readable secondary text
and restrained borders. Ordinary lists use separators; reserve cards for grouped summaries. State
uses text and icons as well as color. Desktop density must not dictate mobile hit areas.

Chat, issue/PR descriptions and comments retain readable Markdown: headings, lists, tables, code,
links and images. Preserve text selection and source-relative links. Long code, tables and paths
must fit or scroll within their content area, without widening the screen; verify populated
examples.

Keep mobile interactive targets at least **44 × 44 points**, even when their visible icon is
smaller, following
[Apple's button guidance](https://developer.apple.com/design/human-interface-guidelines/buttons).
Support Dynamic Type, VoiceOver, keyboard focus, visible pressed/disabled states, reduced motion,
increased contrast, safe areas and keyboard avoidance.

Prefer native tabs, sheets, menus, pickers and buttons. Use Liquid Glass for the navigation/control
layer; keep reading surfaces quiet and respect reduced transparency. Apple's guidance separates
navigation from underlying content and discourages excessive custom glass effects.
([Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass))

**Native navigation stacks are a separate implementation from spacing and styling.** Tasks, Issues,
PRs/Pipelines and Automations now use native stacks with host-scoped routes and back gestures; see
the [navigation follow-through](navigation-follow-through.md) and
[source navigation pass](source-navigation.md). Settings retains local page state. These changes
preserve collection state, incoming links and runtime scoping.

## Delivery and acceptance

1. Validate the desktop/mobile mockups using populated tasks, a failed run, PR review, offline
   computer and folder selection. Confirm terminology and hierarchy.
2. Implement shared tokens, labeled navigation, compact headers and list hierarchy while preserving
   current state ownership and runtime contracts.
3. Apply task/composer, source-detail, automation and settings layouts with targeted regression
   fixtures. Treat native navigation-stack migration as its own reviewed change.
4. Verify narrow desktop windows, small phones, large text, keyboard-open sheets and real native
   controls before packaging.

Acceptance requires visible execution context; preserved three-line threads; distinct state/time;
reachable Chat/Changes/Terminal; no lost drafts or duplicate submissions; first-viewport failure
information; clear review semantics; reliable source backlinks; recoverable offline/error states;
usable folder-list space and confirmation; and no clipping, overlapping controls or inaccessible
actions, including rich Markdown. Compare screenshots and exercise behavior; attractive mockups
alone do not establish completion.
