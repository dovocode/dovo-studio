# Agent PR review

## Continue after a push

When your review is requested, use **Review changes** in the PR list to open the diff directly. On
narrow desktop windows, this action is in the PR row menu.

On desktop and web, tab to **Comment on line** above the file diff and press Enter. Choose **After**
or **Before**, enter a displayed line number, and open the comment editor. Cancel returns focus to
**Comment on line**.

If a new revision arrives while you have the PR open, **Changes** keeps the previous diff read-only.
Select **Switch revision** after the new files load. Dovo keeps the selected file if it is still
part of the diff. Viewed marks stay for files with the same review fingerprint. Line drafts do not
move to new lines or revisions automatically.

On mobile, unsent line comments, PR comments, replies and reviews stay on the phone after the app
closes or the OS stops it. Each draft belongs to its computer, repository account and PR. Posting
removes only that draft. Renewed pairing of the same computer keeps its drafts. Another computer at
the same address does not see them.

Each press of **Post comment** on a line comment saves a submission ID with the draft. Dovo sends
the comment only after the phone confirms that it holds the ID. While storage is slow, the editor
shows that it is saving and offers **Cancel posting**. If storage fails, Dovo does not send the
comment. Select **Retry saving drafts**, then post again. The computer keeps the outcome of each ID
for the paired phone in its database. If the response is lost, the editor asks the computer about
the same ID before anything posts again. A posted comment then closes the editor and removes the
draft. If the phone cannot remove the posted draft, the editor stays open, says the comment was
posted and offers **Retry removing saved copy**. If the app stops first, the reopened draft is
checked before **Post comment** is enabled. A posted comment shows **Remove saved copy**. Receipts
belong to one paired phone on one computer database. After a renewed pairing or a restored computer,
"no record" does not prove that the comment was never posted. For that answer, an uncertain outcome
or an older computer, **Post comment** stays off. Check the PR, then select **Post anyway**. A retry
of an ID without a record keeps that ID, so a receipt the computer can still see returns its first
outcome instead of posting again. Computers without `pullCommentReceiptsSupported` cannot confirm
outcomes. The editor says so before you post, and again after a failed post or for a draft that has
a submission ID.

## Start a review

Enable **Experimental code reviews** in the connected computer's settings. Open the PR overview.
Choose **Review changes** to inspect the files yourself. If repository CI reports a failure, use
**View failed checks** from the PR list to open Checks.

For an agent review, choose **Run agent review** when a reviewer is ready. **Set up agent review**
opens the settings if the reviewer needs a model or the computer needs to reconnect. **Configure
this run** opens the settings for the next run. Choose a provider, model, depth, and optional
project checks, then choose **Start agent review**. The computer remembers the reviewer choice
separately from its title model. Publishing the result remains a separate action.

Use **Open agent review** to see an existing report. Use **View review run** to see a running
review. The PR row menu offers the same three actions. On mobile, touch and hold the row. **Run
agent review** from the list starts a first run if the verified source has a saved reviewer. If
there is already a report or run, it opens that review. If a reviewer needs a model, it opens the
settings. On desktop and web, use the arrow keys, Home, or End to switch review tabs after moving
focus to the tab list.

The review uses the computer's existing agent installation. It does not depend on PR-Agent. It works
with a connected Git project or a supported PR URL. It verifies the PR and forge account on the
chosen computer before starting. A remote review uses that computer's own account, models, project
and report storage. HTTP runtimes, pairing codes and device tokens work as before.

## Read and share a review

Completed reports start with the finding count and commit. File coverage counts the patches supplied
to the reviewer. Project check results come from commands on the review computer. Mobile puts
**Review again** and **Configure this run** under **More review actions**. **View failed project
checks** opens the check results with failures first.

1. Start a review. The runtime captures PR intent and patches between checks of the base and head.
   It reviews every eligible changed file in bounded batches automatically. It then challenges
   supported findings in fresh model calls. Progress shows the active batch and phase.
2. Open a finding's location to see its captured patch. A verified location selects the exact line
   on the reported side. The patch stays tied to the reviewed commit after a push. Close it on
   desktop or choose **Back to findings** on mobile to return to the report position.
3. Open **Evidence and finding check** to see the exact code quote, challenge reason and model
   confidence. Open snapshot context to inspect the surrounding code supplied to the model.
4. Check file coverage. Each batch holds whole patches within a 180,000-character serialized patch
   budget. Generated and vendored text files are included. Binary files are excluded when the forge
   or local attributes identify them. Incomplete, missing, oversized and failed patches have
   separate coverage states. **Review remaining files** retries failed batches and omissions from
   older reports. Dependency lock files, such as `pnpm-lock.yaml`, are excluded. A patch that cannot
   fit one batch is marked too large. Successful files from completed passes stay covered. Each pass
   has its own report. Separate batches and passes can miss bugs that involve files they do not
   analyze together.
5. Select **Add to draft** for findings you want to share. Nothing is selected by default. Select
   **Remove from draft** to undo it. Dovo removes unchanged generated text. It keeps your edited
   text and shows a notice. Dismissing an added finding follows the same rule. Edit the draft and
   choose **Comment** or **Request changes**.
6. Drafts save after a short pause in typing. **Preview review** also saves your latest edits.
   Unsaved edits remain in the client across navigation. Only saved text survives a client restart.
7. Open **Preview review**. Mobile keeps this action in the sheet footer. Check the exact Markdown,
   account, PR, revision, mentions and links. Confirm **Publish review** to post one summary review.

The preview keeps the exact saved draft version and decision. If another client changes them, return
to the draft and open a new preview. Dovo does not change the open preview's decision.

Generated finding text escapes Markdown and neutralizes mentions. Your edits remain unchanged. An
HTML comment in the publication text identifies the report for recovery. GitHub receives the
captured `commit_id`. The flow does not approve or merge PRs.

**Check in repository** opens the existing conversation chooser with an editable question. Choose a
linked thread's side chat or a review thread. The question labels model findings as untrusted
evidence and asks for investigation. Nothing starts until you send the draft.

## Multiple reviewers and images

Select **Add reviewer** to use up to four independent reviewers. Each reviewer has its own provider,
model and reasoning setting. The computer remembers the reviewer list. Every reviewer receives the
same captured patches, project command results and images. Each uses the selected depth and a fresh
challenge call. Reviewers run in order to limit simultaneous provider processes. More reviewers use
more time and model tokens. Project commands run once for the complete review.

Dovo first removes exact duplicate findings. The primary reviewer then groups overlapping findings
in a final combining pass. Each finding names the models that found it. Model agreement is not
proof. The report shows each reviewer's completed batch count and failure. A provider failure keeps
completed results from the other reviewers. File coverage means that at least one reviewer received
that patch. Partial reviewers can have different coverage.

Select **Add images** for screenshots or designs. Desktop accepts PNG, JPEG, WebP and GIF files.
Mobile opens the photo library and uses the existing image optimizer, including HEIC conversion.
Preview the selected images before starting. Attach up to three images, 5 MB each and 10 MB in
total. Each analysis and challenge call receives the images. The runtime verifies the file type from
its bytes. It writes files with generated names into the temporary provider directory and removes
them after each call. Reports retain image names, types, sizes and hashes, without the image bytes.
Images selected in the current client remain available for another pass. They do not survive a
client restart.

Images are user-supplied context. They do not prove that a browser ran or that the PR produced the
image. A finding still requires exact evidence from a changed patch line. A model that rejects image
input fails its own review. Dovo does not silently fall back to text-only analysis.

| Provider                                 | Review support                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex, Claude, OpenCode, Copilot, Cursor | Quick disables tools. Standard and Deep use read-only tools. Image input depends on the chosen model.                                                                                      |
| ACP clients                              | Installed clients appear by name in both reviewer pickers. Quick requires tool-disable support. Standard and Deep require read-only execution. Images also require advertised image input. |
| Vibe                                     | Standard and Deep support read-only tools. Quick is unavailable because the adapter lacks a complete tool-disable path.                                                                    |
| Hermes, Grok, Muse                       | Unavailable because the current adapters cannot enforce the required restricted sessions.                                                                                                  |
| Pi                                       | Unavailable because the adapter requires an imported session and does not accept images.                                                                                                   |

The picker shows unavailable providers with **Unavailable for this review depth**. The runtime
checks the selected provider policy again before starting. Models and ACP clients use the chosen
computer's own installation and credentials. Mocked tests do not establish live provider support.

## Review on another computer

Use **Review on computer** to select a saved paired computer. This keeps the current workspace on
its original computer. The selected computer must be connected and have Experimental code reviews
enabled. It needs its own forge access and reviewer installation. Dovo does not copy credentials or
local project IDs between computers.

Dovo matches projects by forge identity. If several checkouts match, choose one. If none match, a
supported PR URL can use the destination computer's forge account. Private forge URL shapes require
a matching configured project. Source context and project commands need a local project with the
captured commit. The server still checks the PR revision before starting and publishing.

The first read pins the destination account. Later reads keep that guard, including retries. A
changed account or revision blocks the operation. Refresh the source PR if its revision changed.
Reports and drafts stay on their owning computer. Temporary disconnection keeps the open report and
draft visible. Review and publication actions wait for reconnection and verification. The exact
publication preview names the destination account.

## Review a PR stack

For a stacked PR, choose **Full stack** in **Review scope**, then start the review. Dovo reviews
each PR in dependency order. You can start from any member. The stack must be complete and have at
most 100 PRs. Refresh an incomplete stack before starting.

Each PR keeps its own report, coverage, findings, checks and draft. Open a member's review from the
stack progress list. Preview and publish each draft separately. Starting a stack review does not
publish reviews. The same reviewers, depth, images and project-check choice apply to every member.
Project checks run separately at each member's captured head commit.

Dovo pins every member's head and base before queuing the reviews. A changed revision or account
blocks that member. Other members can still finish. **Stop stack review** cancels the active member
and prevents queued members from starting. A runtime restart marks an unfinished queue interrupted.
It does not resume model calls. Start a new stack review to try again.

Each reviewer receives the stack order and member revisions as reference data. Findings cite only
the current PR's supplied changes. Quick has no repository tools. Standard and Deep can read the
captured checkout, including ancestor code that exists there. This does not supply a combined diff
or prove that the model checked every interaction between PRs.

## Choose a computer for PR work

Open **New thread** on desktop or **Start task** on mobile. Choose a computer, then choose the
branch mode. If several projects on that computer match the PR repository, choose a project first.
Open the repository as a project on the destination computer if none match. An offline source
computer does not block this choice when another paired computer is online.

Dovo resolves the destination computer's forge account and checks the PR URL and revision before
creating the thread. Local account IDs are not copied between computers. The new thread and its
navigation use the selected computer. A changed PR blocks task creation. Refresh it before trying
again.

ACP clients use the same model list and reasoning control as built-in providers. Model and reasoning
choices replace conflicting raw ACP configuration values. Other launch settings stay intact. These
controls depend on the models and reasoning choices that each ACP client advertises.

## Review depth and project checks

| Depth                 | File coverage      | Tools     | Extra source context per batch         |
| --------------------- | ------------------ | --------- | -------------------------------------- |
| Quick                 | All eligible files | Disabled  | None                                   |
| Standard, the default | All eligible files | Read-only | 12 files, 48,000 serialized characters |
| Deep                  | All eligible files | Read-only | 32 files, 96,000 serialized characters |

All depths review every available, eligible patch and challenge supported findings in fresh model
calls. Files do not wait for another pass because of a batch-count limit. Generated and vendored
text files are included. Dependency lock files and binary files are skipped. Patches larger than a
single batch, incomplete patches and missing patches have explicit coverage states. Coverage records
evidence supplied to the model. It does not prove that the model checked every line.

Deep keeps the stored `thorough` value so existing reports and older clients remain compatible. The
computer remembers depth. Earlier reports without a depth use Standard. Quick rejects project checks
in the API and disables the option on both clients.

With several reviewers, the primary reviewer runs a final combining pass. It groups overlapping
findings from the same file and patch side, selects an existing finding as the representative and
keeps the reviewer attribution. Every finding must appear in exactly one group. Invalid, incomplete
or failed combining results leave the individual findings intact. The orchestrator cannot invent
code quotes, change anchors or silently drop findings. Its input is capped at 240,000 characters.
The combining pass disables tools and has a two-minute timeout. If the primary provider cannot
disable tools, Dovo keeps the individual findings and records that limit.

Preparation, review, finding checks and combining have an activity animation on desktop and mobile.
The progress bar counts completed batches. It does not estimate time. Reduced-motion settings stop
the animation. Cancellation stops later model calls and keeps results already saved.

**Run project checks** is off by default and requires an explicit start. It installs dependencies
and executes repository code on the connected computer. Enable it only for PR code you trust. The
temporary checkout protects your working files. It is not a security sandbox. Scripts can use
network access and host permissions, as they can in a terminal.

- A local Git project must contain the captured PR head commit. Dovo creates a temporary detached
  clone at that exact commit. It does not switch branches, edit user files, fetch missing commits,
  initialize submodules or hydrate Git LFS files. Git checkout hooks are disabled.
- Automatic checks support a regular root `package.json`. Dovo uses its declared npm, pnpm, Yarn or
  Bun package manager, or detects the manager from lock files. The manager must already be
  installed. Dependencies use `npm ci` or the manager's frozen or immutable install. Install
  lifecycle scripts run. Dovo does not install a package manager or change lock files to recover a
  failed install.
- Dovo runs available root scripts in order: `build`, `check`, `typecheck`, `lint`, `fallow:ci` or
  `fallow`, and `test:ci` or `test`. It sets `CI=true`. Missing scripts are skipped with a reason.
  Fallow must already be part of the project. No new analysis dependency is added.
- An install failure skips later scripts. Other failures remain visible and do not stop the
  remaining checks. Each command has a five-minute limit. The whole check phase has a 20-minute
  limit. Cancellation stops the owned process group and prevents later commands and model calls.
- The report stores the command, captured head SHA, status, exit code, times and up to 20,000
  characters of output per command. Large output keeps its beginning and end with a truncation note.
  Mobile output opens on request. Command output goes into the model as bounded, untrusted evidence.
- A command that changes the checkout commit fails verification and stops later commands. A runtime
  restart marks an unfinished command interrupted. Dovo does not claim that an interrupted command
  passed. Temporary files are removed after process shutdown. If shutdown cannot be confirmed, the
  report identifies the directory kept for inspection.
- URL-only PRs, missing commits and unsupported project manifests show a skipped result. The patch
  review still runs. Passing commands do not prove test coverage or that a model finding is correct.
  Failed commands can reflect setup limits or existing defects. Read their output before acting.

## Evidence and recovery

- Every model call uses a fresh temporary directory and removes agent resources. Quick disables
  tools and aborts on unexpected tool activity. Standard and Deep allow read-only tools. They can
  inspect a separate detached clone of the captured PR head. The clone does not change the user's
  working files. Missing local commits fall back to the supplied evidence with an explicit limit.
  Claude ignores provider settings for these PR calls. Codex disables project instruction loading
  and native delegation. Approvals are denied. Project files remain untrusted evidence.
- The runtime supplies numbered patch lines, PR title and body, and a bounded changed-file manifest.
  For a local Git project, it also tries to read whole changed source files at the captured head
  SHA. If a file is absent there, it tries the captured base SHA. A bounded relative JS/TS import
  heuristic adds nearby modules. This does not resolve aliases, reverse callers or the whole build
  graph.
- Standard context holds at most 12 files and 48,000 serialized characters per batch. Deep context
  holds at most 32 files and 96,000 characters. Quick does not read extra files. Each file has at
  most 16,000 raw characters. Standard tries at most 32 paths from a queue capped at 80. Deep tries
  at most 96 paths from a queue capped at 240. It accepts common source and configuration file
  extensions. It skips truncated previews and oversize files. Git errors appear in the limits.
  Missing heuristic import paths are normal. URL-only reviews and commits unavailable on the
  computer use patch evidence without this context.
- Snapshot reads use Git objects. Read-only tools use the captured clone. Neither reads dirty
  working files. Reviewer prompts prohibit project execution. Git itself still uses the runtime's
  existing Git configuration. The review does not claim that all runtime activity is offline. Dovo
  starts project commands only when you enable **Run project checks**. Standard and Deep rely on the
  provider's read-only restrictions and the review instructions. These restrictions do not establish
  that every provider can prevent all code execution or network access.
- Each analysis JSON input is capped at 240,000 characters. Each challenge JSON input is capped at
  320,000 characters, including candidates. Context and metadata can be reduced to fit, with a note.
  Numbering and JSON escaping count toward these limits. Provider instructions and message framing
  are outside these JSON caps. Each model call has a 60,000-character output cap. Quick has a
  two-minute timeout per call. Standard has five minutes. Deep has ten minutes. These are character
  limits, not model-specific token budgets or context-window guarantees.
- A finding must cite an exact supplied changed path and 1 to 10 consecutive hunk lines, with at
  least one changed line. Confidence must be at least 8/10. Unsupported findings are filtered
  individually. A fresh call with the same evidence challenges the remaining findings. It must
  account for every candidate exactly once. Only supported findings that pass both phases enter the
  report. Confidence is a model judgment, not a measured probability or proof of correctness.
- Successful batches survive other batch failures. A failed or malformed challenge leaves that batch
  incomplete. Cancellation stops later calls. Files waiting for a call are labelled separately from
  supplied patches. Findings become editable when the report completes. Exact duplicates are
  removed. The final report keeps at most 100 findings, ordered by severity and confidence, and
  notes omissions.
- Each reviewer makes one analysis call per batch and one challenge call when it proposes supported
  findings. Multiple reviewers add one combining call when findings exist. The batch count depends
  on the eligible patch size. A batch with no supported candidates needs no challenge call. This can
  cost more and take longer than the previous single call. There is no measured latency or accuracy
  claim. Supplying a patch does not prove that the model checked every line. The same model can
  repeat a mistake in both phases.
- A push preserves the old report and draft. Publishing checks both commits and the evidence
  fingerprint again. It rejects a stale report.
- Reports, coverage, drafts and publication intent live in SQLite on the owning runtime. A process
  restart marks an unfinished pass interrupted and an unfinished publication unknown. It does not
  start a model or repost a review automatically.
- Studio keeps pending review text on this device across reloads and restarts. Open the same review
  after reconnecting to continue. Studio removes its local copy after the computer confirms the
  save. Draft writes use versions. Conflicting edits remain visible. Refresh the report, compare the
  saved draft, then explicitly choose **Save my draft over this version** if appropriate. **Use the
  saved draft** replaces your unsaved copy only when you choose it.
- A new pass keeps the earlier draft in history. If the new draft is empty, **Copy draft from the
  earlier pass** copies its text and decision. Check its findings and line references before
  posting. Switching passes and starting another pass save the current draft first.
- A lost publish response leaves the outcome unknown. **Check publication** looks for the saved
  report marker in remote reviews. It never submits a second POST. If the marker is unavailable,
  inspect the PR on its forge before starting another report.
- A forge can accept the review text without confirming the review decision. Dovo shows that partial
  result and links to the posted review. It does not repost the text or retry the decision.
  Unsupported review decisions are unavailable when the forge reports its capabilities.
- Publication checks the saved draft version again after fetching the PR. A draft saved by another
  client during that check stays intact. Report sequence numbers prevent late responses from
  replacing newer report state.

Inline batch comments, automatic triggers, cross-computer report sharing and automatic finding
matching across revisions are outside this release. Earlier reports remain available in review
history. An absent finding does not prove a fix.

## Verification

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @dovo/desktop... -r build
pnpm exec vp test packages/runtime/src/scm/reviews/pull-review-engine.test.ts packages/runtime/src/scm/reviews/pull-review-checks.test.ts packages/runtime/src/scm/reviews/pull-review-images.test.ts packages/studio-core/src/scm/pull-review-source.test.ts packages/runtime/src/agents/providers/acp/acp.test.ts packages/runtime/src/agents/providers/acp/acp-v2.test.ts packages/runtime/src/http/pull-code-reviews.test.ts packages/protocol/src/scm/pull-code-review.test.ts packages/runtime/src/agents/tasks/title-generation.test.ts packages/runtime/src/http/file-reviews.test.ts packages/protocol/src/scm/task-review.test.ts --maxWorkers=4
pnpm exec playwright install chromium
node scripts/check-pr-code-review-browser.mjs
node scripts/check-harness-row-browser.mjs
node scripts/check-pr-task-checkout-browser.mjs
node scripts/check-mobile-pull-handoff-browser.mjs
node scripts/check-mobile-integration-continuity-browser.mjs
node scripts/check-native-audit-browser.mjs
node scripts/check-native-composer-bridge-browser.mjs
node scripts/check-message-references-browser.mjs
node scripts/check-browser-tabs-browser.mjs
node scripts/check-mobile-previews-browser.mjs
node scripts/check-mobile-shared-browser-browser.mjs
```

The stack tests check parent-first execution through authenticated HTTP, separate findings,
incomplete stack rejection, revision changes, cancellation and restart recovery. Browser checks
cover stack scope, member navigation and stop requests. The PR task browser check covers remote
project and account resolution, destination navigation, and blocking writes after a revision change.
The ACP picker browser check covers model and reasoning selection while preserving launch settings.
These tests use mocked computers, forge responses and ACP catalogs. They do not verify a live ACP
client or a physical device.

The PR browser check uses the real report controller and interface components with mocked model,
forge, diff renderer and native controls. It checks start, draft saving, preview, explicit
publication and stale draft retention. It also checks first-use setup, saved reviewer start, finding
removal, edited-text preservation, copying earlier drafts, saving on preview, failed publish
retention and the in-flight publication guard. It checks evidence disclosures, snapshot navigation
and active batch progress. It also checks multiple model selection, visual input, remote host
routing and destination-local account IDs. Runtime tests check exact finding attribution, failed
reviewer recovery, image delivery to both passes, temporary file cleanup and image validation.
Source tests reject wrong projects, stale revisions and account guard changes. It saves screenshots
in `output/pr-review-checks`. Runtime tests use real HTTP authentication and SQLite, with mocked
forge and provider boundaries. They exercise the real utility runner, Quick tool denial, and
Standard and Deep read-only policies. A real Git fixture verifies that committed source and imported
context reach the model while later working-tree edits do not. Engine tests cover serialized
budgets, exact quotes, deletion evidence, confidence filtering, malformed challenge IDs, duplicate
findings, partial failure recovery and cancellation. These checks do not establish live model
quality, remote forge behavior, or native iOS and Android layout.

The command runner tests use real Git, npm and small Node fixture scripts. They check the captured
commit, dirty file preservation, command failures, output limits, cancellation, timeout and cleanup.
The fixture lint and Fallow scripts test command execution and result capture. They do not test
those tools' analysis quality. Browser checks cover review options and command output, Enter
navigation, redirects, focus catch-up and unsent address drafts. Mobile checks adapt native controls
and browser events. They do not run a physical iPhone, Android device or WebKit engine.

The mobile sent-message fix gives Yoga a transparent text projection to measure before the native
reference renderer lays out. Native text still handles selection, copy and links. The bridge check
tests the layout contract with adapted native controls. Run Device Hub checks on iOS and Android
before treating those platforms as verified.

See [PR-Agent source investigation](pr-review-research.md) for inspected sources and design
decisions.

## Image sources

The `cliproxy-imagegen` skill generated all three images with `gpt-image-2.6`. The first image is
bundled as a small WebP data URI in `packages/design/src/pr-review-illustration.ts`. It needs no
network. The second image guided the full PR and review layout. The third guided the simpler setup,
draft actions and fixed mobile footer after Fable and Opus reviewed the implementation. These are
design references, not screenshots of the running application.

Source files:

- `output/imagegen/pr-review.png`
- `output/imagegen/pr-review-workspace.png`
- `output/imagegen/pr-review-flow-refined.png`

The illustration prompt was:

> Create a restrained editorial product illustration for Dovo Studio code review empty state. A
> precise abstract arrangement of three small translucent glass document cards, each with a few
> simple horizontal code marks, and a small soft teal circular check beside the front card. Warm
> graphite background #17191c, muted teal and pale ivory accents, subtle soft studio lighting,
> generous negative space, calm professional developer tool aesthetic. No letters, words, logos,
> borders, or UI screenshot. Center the objects, with the surrounding background solid dark
> graphite. Wide composition suitable for a compact banner.

The full interface prompt was:

> Design a high fidelity desktop and mobile product UI reference for Dovo Studio, a professional
> native developer workspace. Show the complete pull request and agent code review experience, as a
> wide desktop interface on the left with a companion narrow mobile screen on the right. Dark
> neutral graphite theme, thin quiet borders, restrained mint teal accents, legible off-white
> typography, compact comfortable spacing, thoughtful visual hierarchy. Desktop: slim left project
> navigation, PR header with number 184, title Preserve draft state after reconnect, author and
> branch pills and green open badge, tab row Overview Changes Checks, compact readiness strip, main
> split area with changed-file list and code diff on left and Agent review findings panel on right.
> Findings panel has reviewer model control, two concrete bug findings with severity labels, path
> and line links, Add to draft and Check in repository actions, a discreet coverage indicator, and a
> bottom Review draft footer with Preview review button. Include a small elegant generated
> glass-document illustration only in an empty state inset, not as a hero. Mobile: PR title and open
> badge, Overview Changes Checks tabs, Agent review card with review summary, findings list and
> sticky Preview review action. Show exact publication preview as a small lower inset with account,
> repository and revision. This is an engineering tool, never a marketing landing page. No bright
> blue gradients, giant headlines, giant cards, decorative charts, or oversized rounded containers.
> Use the space for real useful code and concise text. Pixel precise production UI concept with
> clear interactive control placement.

The refinement prompt was:

> Create a refined production UI reference for the full Dovo Studio pull request and agent review
> flow. Three connected views on one landscape canvas: desktop PR workspace, mobile review findings,
> mobile exact publish preview. Professional dark graphite developer tool with restrained mint
> accents, thin borders, readable compact type, no decorative charts. Desktop has PR header number
> 184 Preserve drafts after reconnect, Open status, Overview Changes Checks Agent review tabs. Agent
> review tab has compact reviewer dropdown already set to Opus, quiet revision and file coverage
> status, captured code diff on the left and two actionable bug findings on right. Each finding has
> severity, title, file line, concise impact, Add to draft primary action and Check in repository
> secondary action. History and full coverage are collapsed controls. One review draft area under
> findings shows two selected findings, Saved on computer, and one clear sticky Preview review
> primary button. No separate mandatory Save step. First-time setup is a small inline Choose
> reviewer control followed by Start review; repeat use needs one click. Mobile findings screen uses
> the same hierarchy and full-width 44 pixel touch targets; sticky bottom bar says 2 findings in
> draft and Preview review. Mobile preview shows account dominic, PR number and revision, exact
> Markdown, Back to draft and Publish review. Explicit publish only. Keep the whole PR workspace
> coherent, uncluttered and intuitive. Use real concise engineering text. This is an interface
> design reference, not artwork or marketing.
