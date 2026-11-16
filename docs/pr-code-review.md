# Agent PR review

Enable **Experimental code reviews** in the connected computer's settings. Open a PR and select
**Agent review** on desktop, or **Review with agent** on mobile. Choose a provider and model. The
computer remembers this choice separately from its title model. On mobile, the PR card opens the
review sheet. Choose the depth and optional project checks, then select **Start review**.

The review uses the computer's existing agent installation. It does not depend on PR-Agent. It works
with a connected Git project or a supported PR URL. It verifies the PR and forge account on the
chosen computer before starting. A remote review uses that computer's own account, models, project
and report storage. HTTP runtimes, pairing codes and device tokens work as before.

## Read and share a review

1. Start a review. The runtime captures PR intent and patches between checks of the base and head.
   It reviews the selected number of batches automatically. It then challenges supported findings in
   fresh model calls. Progress shows the active batch and phase.
2. Read the findings beside the captured diff. On mobile, open a finding's file to read its diff.
3. Open **Evidence and finding check** to see the exact code quote, challenge reason and model
   confidence. Open snapshot context to inspect the surrounding code supplied to the model.
4. Check file coverage. Each batch holds whole patches within a 180,000-character serialized patch
   budget. Generated, vendored and binary files are excluded when the forge or local attributes
   identify them. Incomplete, missing, oversized and failed patches have separate coverage states.
   **Review remaining files** retries failed batches and files omitted by the batch limit.
   Successful files from completed passes stay covered. Each pass has its own report. Separate
   batches and passes can miss bugs that involve files they do not analyze together.
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

Dovo combines findings only when their location, code evidence and normalized title match exactly.
Each finding names the models that found it. Different findings remain separate. Model agreement is
not proof. The report shows each reviewer's completed batch count and failure. A provider failure
keeps completed results from the other reviewers. File coverage means that at least one reviewer
received that patch. Partial reviewers can have different coverage.

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

| Provider                                 | Bounded review support                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Codex, Claude, OpenCode, Copilot, Cursor | Uses the existing adapter with tools disabled and native image input. The selected model must accept images. |
| Configured ACP agents                    | Uses restricted execution. Visual review also requires advertised image input.                               |
| Hermes, Grok, Muse, Vibe                 | Unavailable. Current adapters lack a complete tool-disable path for this review mode.                        |
| Pi                                       | Unavailable. The adapter requires an imported session and does not accept images.                            |

Unavailable providers remain visible with **Tool-free review unavailable**. Dovo does not enable
their tools to bypass this limit. Provider and model access still depends on the selected computer's
installation and credentials. No live provider claims follow from the mocked checks below.

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

## Review depth and project checks

| Depth                 | Patch batches | Extra source context per batch         |
| --------------------- | ------------- | -------------------------------------- |
| Quick                 | 1             | None                                   |
| Standard, the default | Up to 4       | 12 files, 48,000 serialized characters |
| Thorough              | Up to 12      | 32 files, 96,000 serialized characters |

All depths check the evidence and challenge supported candidates in a fresh model call. Depth sets
coverage and context limits. It does not promise that a model read every line. **Review remaining
files** uses the selected depth for another pass. The computer remembers depth. Earlier reports
without a depth use Standard.

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

- The model runs in a fresh temporary directory with tools disabled and agent resources removed.
  Claude does not load repository settings in this mode. Unexpected tool activity aborts the pass.
- The runtime supplies numbered patch lines, PR title and body, and a bounded changed-file manifest.
  For a local Git project, it also tries to read whole changed source files at the captured head
  SHA. If a file is absent there, it tries the captured base SHA. A bounded relative JS/TS import
  heuristic adds nearby modules. This does not resolve aliases, reverse callers or the whole build
  graph.
- Standard context holds at most 12 files and 48,000 serialized characters per batch. Thorough
  context holds at most 32 files and 96,000 characters. Quick does not read extra files. Each file
  has at most 16,000 raw characters. Standard tries at most 32 paths from a queue capped at 80.
  Thorough tries at most 96 paths from a queue capped at 240. It accepts common source and
  configuration file extensions. It skips truncated previews and oversize files. Git errors appear
  in the limits. Missing heuristic import paths are normal. URL-only reviews and commits unavailable
  on the computer use patch evidence without this context.
- Snapshot reads use existing Git object previews. They do not read dirty working files or execute
  PR code. Git itself still uses the runtime's existing Git configuration. The review does not claim
  that all runtime activity is offline. Project code runs only when you enable **Run project
  checks**.
- Each analysis JSON input is capped at 240,000 characters. Each challenge JSON input is capped at
  320,000 characters, including candidates. Context and metadata can be reduced to fit, with a note.
  Numbering and JSON escaping count toward these limits. Provider instructions and message framing
  are outside these JSON caps. Each model call has a 60,000-character output cap and a 120-second
  timeout. These are character limits, not model-specific token budgets or context-window
  guarantees.
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
- Quick can make up to two model calls, Standard up to eight, and Thorough up to 24. A batch with no
  supported candidates needs no challenge call. This can cost more and take longer than the previous
  single call. There is no measured latency or accuracy claim. Supplying a patch does not prove that
  the model checked every line. The same model can repeat a mistake in both phases.
- A push preserves the old report and draft. Publishing checks both commits and the evidence
  fingerprint again. It rejects a stale report.
- Reports, coverage, drafts and publication intent live in SQLite on the owning runtime. A process
  restart marks an unfinished pass interrupted and an unfinished publication unknown. It does not
  start a model or repost a review automatically.
- Draft writes use versions. Conflicting edits remain visible. Refresh the report, compare the saved
  draft, then explicitly choose **Save my draft over this version** if appropriate. **Use the saved
  draft** replaces your unsaved copy only when you choose it.
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

Inline batch comments, automatic triggers, tool-enabled repository PR reviews, cross-computer report
sharing and automatic finding matching across revisions are outside this release. Earlier reports
remain available in review history. An absent finding does not prove a fix.

## Verification

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @dovo/desktop... -r build
pnpm exec vp test packages/runtime/src/scm/reviews/pull-review-engine.test.ts packages/runtime/src/scm/reviews/pull-review-checks.test.ts packages/runtime/src/scm/reviews/pull-review-images.test.ts packages/studio-core/src/scm/pull-review-source.test.ts packages/runtime/src/agents/providers/acp/acp.test.ts packages/runtime/src/agents/providers/acp/acp-v2.test.ts packages/runtime/src/http/pull-code-reviews.test.ts packages/protocol/src/scm/pull-code-review.test.ts packages/runtime/src/agents/tasks/title-generation.test.ts packages/runtime/src/http/file-reviews.test.ts packages/protocol/src/scm/task-review.test.ts --maxWorkers=4
pnpm exec playwright install chromium
node scripts/check-pr-code-review-browser.mjs
node scripts/check-native-composer-bridge-browser.mjs
node scripts/check-message-references-browser.mjs
node scripts/check-browser-tabs-browser.mjs
node scripts/check-mobile-previews-browser.mjs
node scripts/check-mobile-shared-browser-browser.mjs
```

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
forge and provider boundaries. They exercise the real tools-disabled utility runner. A real Git
fixture verifies that committed source and imported context reach the model while later working-tree
edits do not. Engine tests cover serialized budgets, exact quotes, deletion evidence, confidence
filtering, malformed challenge IDs, duplicate findings, partial failure recovery and cancellation.
These checks do not establish live model quality, remote forge behavior, or native iOS and Android
layout.

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
