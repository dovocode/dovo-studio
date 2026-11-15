# Agent PR review

Enable **Experimental code reviews** in the connected computer's settings. Open a PR and select
**Agent review** on desktop, or **Review with agent** on mobile. Choose a provider and model. The
computer remembers this choice separately from its title model. Later mobile reviews start from the
PR card with one tap.

The review uses the computer's existing agent installation. It does not depend on PR-Agent. It works
with a connected Git project or a supported PR URL. It requires the same verified forge destination
that supplied the visible PR. Switch to that computer and account if the source guard rejects the
request. HTTP runtimes, pairing codes and device tokens work as before.

## Read and share a review

1. Start a review. The runtime captures PR intent and patches between checks of the base and head.
   It reviews up to four batches automatically. It then challenges supported findings in fresh model
   calls. Progress shows the active batch and phase.
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

## Evidence and recovery

- The model runs in a fresh temporary directory with tools disabled and agent resources removed.
  Claude does not load repository settings in this mode. Unexpected tool activity aborts the pass.
- The runtime supplies numbered patch lines, PR title and body, and a bounded changed-file manifest.
  For a local Git project, it also tries to read whole changed source files at the captured head
  SHA. If a file is absent there, it tries the captured base SHA. A bounded relative JS/TS import
  heuristic adds nearby modules. This does not resolve aliases, reverse callers or the whole build
  graph.
- Context holds at most 12 files and 48,000 serialized characters per batch. Each file has at most
  16,000 raw characters. The reader tries at most 32 unique paths from a queue capped at 80 entries.
  It accepts common source and configuration file extensions. It skips truncated previews and
  oversize files. Git errors appear in the limits. Missing heuristic import paths are normal.
  URL-only reviews and commits unavailable on the computer use patch evidence without this context.
- Snapshot reads use existing Git object previews. They do not read dirty working files or execute
  PR code. Git itself still uses the runtime's existing Git configuration. The review does not claim
  that all runtime activity is offline. No setup or tests run.
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
- The automatic flow can make up to eight model calls per review. A batch with no supported
  candidates needs no challenge call. This can cost more and take longer than the previous single
  call. There is no measured latency or accuracy claim. Supplying a patch does not prove that the
  model checked every line. The same model can repeat a mistake in both phases.
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
pnpm exec vp test packages/runtime/src/scm/reviews/pull-review-engine.test.ts packages/runtime/src/http/pull-code-reviews.test.ts packages/protocol/src/scm/pull-code-review.test.ts packages/runtime/src/agents/tasks/title-generation.test.ts packages/runtime/src/http/file-reviews.test.ts packages/protocol/src/scm/task-review.test.ts --maxWorkers=4
pnpm exec playwright install chromium
node scripts/check-pr-code-review-browser.mjs
node scripts/check-native-composer-bridge-browser.mjs
node scripts/check-message-references-browser.mjs
```

The PR browser check uses the real report controller and interface components with mocked model,
forge, diff renderer and native controls. It checks start, draft saving, preview, explicit
publication and stale draft retention. It also checks first-use setup, saved reviewer start, finding
removal, edited-text preservation, copying earlier drafts, saving on preview, failed publish
retention and the in-flight publication guard. It checks evidence disclosures, snapshot navigation
and active batch progress. It saves screenshots in `output/pr-review-checks`. Runtime tests use real
HTTP authentication and SQLite, with mocked forge and provider boundaries. They exercise the real
tools-disabled utility runner. A real Git fixture verifies that committed source and imported
context reach the model while later working-tree edits do not. Engine tests cover serialized
budgets, exact quotes, deletion evidence, confidence filtering, malformed challenge IDs, duplicate
findings, partial failure recovery and cancellation. These checks do not establish live model
quality, remote forge behavior, or native iOS and Android layout.

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
