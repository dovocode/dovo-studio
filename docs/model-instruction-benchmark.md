# Model instruction review

Dovo adds tool guidance to each agent run. This review changes that generated guidance, not the
user's agent text, project instructions, harness files or Bot responsibilities.

The shared rules now live in `packages/runtime/src/agents/execution/model-tool-instructions.ts`. The
turn runner passes the same feature and access settings that control its tool catalog. The runtime
still enforces access. Instruction text does not replace those checks.

Changes:

- State when to use tools, when to answer directly and when to reuse known IDs.
- Select one PR policy. Normal monitoring needs an authorized request. Enabled PR follow-up checks
  watch status first. Stopped watches require an explicit user restart. Merge stays manual.
- Complete other requested work after registering CI or PR monitoring. Use durable notifications
  instead of waiting or polling for results.
- Name only enabled Studio tools. Keep native device discovery and project-link activation rules.
- Keep pending forms, saved checklists, Memory, worker results and external content separate from
  permission to act. Keep private input out of chat and tool results.
- Wait for confirmed private-input completion without polling. Check an uncertain watch registration
  once before retrying. Keep recovery within the requested operation and sources.
- Accept structured checkout metadata or its JSON encoding at the MCP boundary. Decode and validate
  the original command before HTTP delivery. Treat `null` as omitted only for the three optional
  checkout fields that already advertise nullable input. Keep required fields and access checks.
- Expose private-input and project-link fields at the schema root. Keep their per-action validation.
  Share the checkout definition to keep the context budget.
- Treat cancelled or failed private input as an unmet delivery condition. Stop after the second
  identical argument error.
- Return `deliveryCompleted` and next-step guidance in private-input MCP results. Pending results
  tell agents to finish independent work and return. Failed delivery keeps dependent work blocked.
  The HTTP status contract and human review stay unchanged.

The full-feature instruction count excludes user instructions, Bot text, live browser endpoints,
working-directory metadata and tool schemas. Character counts are not model token counts. The final
full-feature block has 8,225 characters. The original has 9,233. The reduction is 10.9%.

## Evaluation

The checks use OpenCode CLI 2.3.0. The first checks use these requested models:

- `dovo/deepseek-v4.1-flash:dev:prio`
- `dovo/qwen3.8-27b:dev:prio`

Rounds 6–10 also use `dovo/glm-5.3-flash:dev:prio`. Sessions request variant `low`. Independent
batches can overlap. These results do not compare latency.

The initial wording comparison uses the same tool schemas and cases. The extra rounds record schema
changes separately. The first comparisons use 16 real Dovo tool definitions. Round 12 expands the
catalog to 23. Memory scopes match the tested instruction profiles. All MCP actions use fixtures.
Native tools are denied. Sessions use temporary folders and are interrupted and removed after each
case. No deployment, private-input request or real device action runs.

Cases cover completing two requested actions, stopped PR watches, optional PR monitoring, failed
watch registration, hostile Memory content, project-only Memory, unanswered forms, stale checklists,
new project links and plans that do not authorize workers. Additional cases test independent work
after a failure or pending question, uncertain registration, pending private input and source
limits.

A case passes when the recorded calls have valid arguments, match its expected actions and contain
no extra actions. Independent actions can run in either order. The checklist and new-link cases also
permit one read to confirm their current state. Selected cases check short outcome phrases in the
reply. The scorer also counts argument rejections saved by OpenCode before MCP, native attempts and
timeouts. These checks do not validate every claim in prose. An extra status read can fail the
strict score even when the final answer is correct. Such a failure is not a permission violation.

Early pilot runs had mismatched Memory scopes and an incomplete project-link fixture. Those runs are
excluded from the comparison. The corrected suite also allows a read of the current checklist. For
the five extra rounds, the link fixture stays empty until a valid add succeeds. Older fixtures could
report a link after a failed add. Do not compare those link scores directly.

The first broad comparison passed 8/9 cases for DeepSeek with both original and revised text. Qwen
passed 7/9 with the original and 5/9 with the revised text. That result did not support keeping the
shortest wording without more checks. The initial focused checks passed 2/2 for DeepSeek with both
versions. Qwen passed 1/2 with the original and 2/2 with the next revision. The saved report keeps
these results alongside the extra rounds.

## Five additional functional rounds

Each round used both requested models. The five rounds completed 60 case executions. The first three
rounds used the same four focused cases. Round 4 added six cases. Round 5 checked the ten original
cases plus uncertain watch registration and pending private input.

| Round | Change or focus                                                      | DeepSeek | Qwen  |
| ----- | -------------------------------------------------------------------- | -------- | ----- |
| 1     | Stopped watches, plans, known IDs and argument errors                | 4/4      | 3/4   |
| 2     | Decode checkout JSON at the MCP boundary                             | 3/4      | 4/4   |
| 3     | Match nullable optional checkout fields to the advertised schema     | 3/4      | 3/4   |
| 4     | Independent work, uncertain results, private input and source limits | 5/6      | 5/6   |
| 5     | Final regression with revised waiting and recovery rules             | 11/12    | 11/12 |

The checkout failures exposed two argument problems. Qwen supplied a JSON string where the tool
required an object. DeepSeek supplied nullable optional fields that the advertised schema permitted
but the runtime rejected. The MCP decoder now accepts those forms and validates the original
command. The real stdio-to-HTTP test verifies the link state through SQLite. It also checks
malformed input, stable retries and access limits.

Round 3 still recorded an unrelated lookup by DeepSeek and an empty argument call by Qwen. Both
models later completed the requested action. The strict score keeps those failures.

In round 4, both models checked private-input status after a confirmed pending result. Qwen also
made an empty argument call and repeated the status check. The final wording tells agents to wait
for the completion message. It also separates uncertain watch registration from confirmed failure
and keeps recovery within the requested operation and sources.

Both final runs used valid arguments, with no saved argument rejections or native tool attempts.
Both still made one extra private-input status call. Neither prepared the workflow before delivery.
That extra call is the remaining strict failure for each model. The wording did not remove it.

The saved [report](../scripts/benchmarks/model-instructions/2026-11-14.json) keeps the earlier
comparison, every extra round, prompts, tool results, rejected arguments, replies, profile snapshots
and catalog hashes. At that point, the source passed 171 targeted tests, 11 benchmark checks, the
runtime build and runtime type check. Repository checks reported zero errors and 33 warnings.

This is a small synthetic regression check. It does not establish real task completion, resistance
to every prompt injection, physical device behavior or a general increase in model reliability.
Models can vary between runs. Keep failed cases and timeouts in the results.

## Five more rounds

Rounds 6–10 add GLM to every round. The main rounds complete 102 case executions. Three Memory
fixture checks and six private-input checks verify issues found in the final round. Keep those
follow-ups separate from the main scores.

| Round | Change or focus                                                     | DeepSeek | Qwen  | GLM   |
| ----- | ------------------------------------------------------------------- | -------- | ----- | ----- |
| 6     | Remove conflicting status advice; test waiting and recovery         | 3/4      | 4/4   | 1/4   |
| 7     | Expose private-input fields at the schema root                      | 4/4      | 4/4   | 4/4   |
| 8     | Completed/cancelled delivery, Memory revisions and independent work | 6/6      | 5/6   | 6/6   |
| 9     | Source limits, PR opt-outs, plans, Memory scope and project links   | 8/8      | 7/8*  | 7/8   |
| 10    | Project-link root fields, delivery conditions and regression checks | 10/12    | 11/12 | 11/12 |

The round 9 Qwen score is recorded as 7/8. Its missing-note reply was correct. The phrase check did
not accept "There is no system Memory note." The corrected score is 8/8. The report keeps the
original score and a separate correction. Required calls and scope checks did not change.

GLM produced empty arguments for private-input and project-link unions. Root field declarations made
those arguments visible without removing per-action checks. GLM passed the four private-input cases
in round 7 and the project-link case in round 10. This small comparison does not prove how the
provider handles schemas internally. Shared checkout definitions keep the existing context budgets.
The schema layout adds 1,154 characters compared with round 6. Description text remains 10,948
characters across 51 tools.

Qwen attempted to prepare a review card after cancelled delivery in round 8. The mock rejected it,
and no workflow ran. The next revision explicitly treats pending, cancelled and failed input as an
unmet delivery condition. All three models passed that case in the main final round.

Descriptions alone did not stop pending-status calls. DeepSeek and Qwen each made an extra status
call in round 10. GLM made 23 and reached the two-minute case deadline. The final change adds
`deliveryCompleted` and next-step guidance to the production MCP result. It also restores the
explicit rule against rechecking confirmed pending input.

| Focused check after the main rounds          | DeepSeek | Qwen | GLM |
| -------------------------------------------- | -------- | ---- | --- |
| Corrected Memory fixture                     | 1/1      | 1/1  | 1/1 |
| Production pending/cancelled result guidance | 2/2      | 2/2  | 2/2 |

The Memory fixture had acknowledged a write but returned the old note on later reads. It now retains
content and revision, rejects unknown scope/key pairs and checks revision conflicts. The original
DeepSeek failure also includes an extra projectless read. It stays in the main score. The focused
repeat uses the same instructions, catalog and strict scoring with the corrected fixture. All three
models pass it.

The private-input follow-up uses the production result helper. Each model makes one request for
pending input and returns without status polling. Each also reports cancellation, renames the
independent terminal and leaves workflow preparation blocked. At the end of round 10, the full
12-case group had not been repeated with this response change. Round 11 below repeats it. The
earlier focused checks remain separate from the full-suite score.

All model-side MCP actions remain mocked. Separate real stdio-to-HTTP tests cover schema validation,
private stdin delivery, response guidance and secret exclusion. The final source passes 178 targeted
tests, 16 benchmark checks, the runtime build and runtime type check. Repository checks report zero
errors and 33 warnings. Usage for timed-out requests can be missing, so reported token totals are
incomplete cost data.

## Rounds 11 through 15

These five rounds test useful task steps as well as restraint. Round 11 repeats the full 12-case
regression after the round 10 result-guidance fix. All three models pass it. Round 12 adds seven
real tool definitions for help, workflow discovery, Memory search, response paging and artifact
edits. Later rounds keep the 23-tool catalog. Native tools stay denied and all MCP actions stay
mocked.

The new cases check returned cursors, section IDs, retained response pages, revision numbers and
complete edited text. Artifact edits must keep unrelated text and final newlines. Other cases check
explicit user answers, displayed defaults, expired input, missing workflows and revision conflicts.
The scorer accepts an omitted first response offset or an explicit zero. It rejects starting at the
second page. Supply saved case definitions with `--case-definitions` to repeat an older round after
new cases are added.

DeepSeek read workflow metadata while required input was missing, even when the workflow ID was
known. The first shorter candidate did not stop those reads. The final wording explicitly checks
required answers or input before dependent reads and actions. It also tells the model to skip
blocked work. Qwen removed a final newline during an artifact edit. The artifact update description
now states that untouched content, including final newlines, must stay exact. Both original failures
remain in the report.

One submitted-answer fixture needed correction. Dovo's question tool returns status and delivery
metadata. The answer arrives through the conversation. The first DeepSeek and GLM round 13 pilots
returned answer content in the tool result. Their raw passing scores stay recorded, but they do not
verify Dovo's production answer flow. Qwen round 13 and all final runs instead receive an explicit
user follow-up. A separate case checks that an answered status without choice content cannot select
a database. These variants have separate saved case hashes.

| Round | DeepSeek | Qwen  | GLM   |
| ----- | -------- | ----- | ----- |
| 11    | 12/12    | 12/12 | 12/12 |
| 12    | 6/6      | 5/6   | 6/6   |
| 13    | 5/6      | 4/6   | 6/6   |
| 14    | 4/6      | 5/6   | 6/6   |
| 15    | 18/21    | 20/21 | 21/21 |

Round 13 includes the two answer-shaped pilots described above. Its submitted-answer case differs
between Qwen and the other models. The final 21-case round uses common cases and profiles for all
three models. Each final run splits at the existing reported-token cap and continues only cases that
have not run. Raw capped batches and complete combined case lists stay in the report.

The wider round still records failures. DeepSeek asked an unnecessary stopped-watch question, read a
workflow while input was pending and removed a final newline during an artifact edit. Qwen also
listed workflows while a form answer was pending. Both kept dependent work blocked. DeepSeek kept
the watch stopped. Exact whitespace preservation remains a limit of these model-generated
full-content edits.

The six-case follow-up passes 6/6 for each model. It puts the known-ID and required-input rules in
the workflow tool descriptions and tells agents to report a stopped watch without restart prompts.
Each model keeps blocked work blocked, avoids the extra reads and questions, and still prepares a
directly requested review when its input is ready. This is a focused repeat. The full 21-case group
was not repeated after this wording change.

A discovery control then checks that unknown workflow IDs still trigger lookup and pagination. Qwen
and GLM pass. DeepSeek first sends the literal string `"null"` as its cursor. The fixture rejects
it. DeepSeek recovers and prepares the correct review, but the extra call fails the strict score.
The list description now says to omit the cursor on the first call. All three models pass the
one-case repeat. The wider 21-case group and six-case follow-up were not repeated after this last
cursor clarification.

The main round 15 guidance has 8,209 characters. Its focused revision has 8,225, 66 fewer than the
round 11 profile. The full 51-tool catalog has 10,991 description characters. The artifact
clarification adds 13 characters. The workflow descriptions and cursor clarification add 30 more. No
context budget increased. Character counts do not establish model token use or task reliability. The
changed cases and catalog sizes also prevent treating the round scores as one controlled comparison.

The five rounds contain 153 case executions. The focused follow-up adds 18. Discovery controls add
six more. Two earlier answer pilots remain in the raw data with their contract limit stated above.
All model-side MCP actions remain mocked. The final source passes 178 targeted tests, 22 benchmark
checks, the runtime build and runtime type check. Repository checks report zero errors and 33
existing warnings.

## Run the checks

```sh
pnpm --filter @dovo/runtime... -r build
pnpm --filter @dovo/runtime typecheck
pnpm exec vp test --maxWorkers=2 \
  packages/runtime/src/agents/execution/model-tool-instructions.test.ts \
  packages/runtime/src/agents/tasks/tasks.test.ts \
  packages/runtime/src/agent-tools \
  packages/protocol/src/tasks/bots.test.ts \
  packages/runtime/src/agents/execution/skill-context.test.ts
node --test scripts/all-tool-instruction-cases.test.mjs \
  scripts/model-instruction-cases.test.mjs \
  scripts/benchmark-tool-descriptions.test.mjs
node scripts/benchmark-tool-descriptions.mjs --suite instructions \
  --capture /tmp/dovo-instruction-tools.json --all-tools
```

Live runs use configured provider credentials and can incur charges. Export the final saved
profiles, catalog and cases:

```sh
node --input-type=module - <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs'
const report = JSON.parse(readFileSync('scripts/benchmarks/model-instructions/2026-11-14.json', 'utf8'))
const saved = report.allToolsFunctionalRounds
writeFileSync('/tmp/dovo-instruction-profiles.json', JSON.stringify(saved.finalInstructions))
writeFileSync('/tmp/dovo-instruction-tools.json', JSON.stringify(saved.catalogs[saved.finalCatalogHash], null, 2) + '\n')
writeFileSync('/tmp/dovo-instruction-cases.json', JSON.stringify(saved.finalCases))
NODE
```

Pass the installed OpenCode executable explicitly. This example runs two focused cases:

```sh
node scripts/benchmark-tool-descriptions.mjs --run --suite instructions \
  --cases run-authorized-workflow,remote-thread-reference \
  --case-definitions /tmp/dovo-instruction-cases.json \
  --instructions /tmp/dovo-instruction-profiles.json \
  --catalog /tmp/dovo-instruction-tools.json \
  --output /tmp/dovo-instruction-results.json \
  --model dovo/deepseek-v4.1-flash:dev:prio \
  --executable /absolute/path/to/opencode
```

Repeat with `dovo/qwen3.8-27b:dev:prio`. Each saved run records its full `requested` case list. Pass
that list with `--cases` to repeat it. The 20-minute batch deadline, two-minute case deadline and
soft cap of 500,000 reported tokens still apply. A request can exceed the token cap before it
returns usage. Missing usage remains unknown.

Use `dovo/glm-5.3-flash:dev:prio` for GLM. Current instruction runs use the production private-input
result helper. Pass `--legacy-state-results` to compare plain status replies. The corrected Memory
fixture stays active. Historical main scores and raw results remain in the report.

## All-tool rounds 16 through 25

Ran ten more rounds on all three requested models, with 53 tools in every catalog. The matrix covers
each tool across the rounds. It does not test every action in every round. The earlier full capture
omitted Bot history and skill proposals. `--capture --all-tools` now includes these tools and all
four Memory scopes. Existing capture defaults and context budgets stay unchanged.

| Round | DeepSeek | Qwen | GLM  |
| ----- | -------- | ---- | ---- |
| 16    | 6/7      | 6/7  | 6/7  |
| 17    | 4/6      | 3/6  | 3/6  |
| 18    | 3/6      | 2/6  | 3/6  |
| 19    | 2/6      | 2/6  | 4/6  |
| 20    | 4/7      | 6/7  | 6/7  |
| 21    | 6/8      | 5/8  | 5/8  |
| 22    | 7/7      | 6/7  | 6/7  |
| 23    | 6/6      | 5/6  | 5/6  |
| 24    | 6/7      | 6/7  | 5/7  |
| 25    | 7/10     | 7/10 | 8/10 |

These are strict scores for the recorded cases. They include quota errors, timeouts, extra calls and
literal text differences. Round 16 used pilot fixtures. Rounds 22 through 24 correct the listed
contract and expectation errors. See `allToolsFunctionalRounds.fixtureLimits` in the
[saved report](../scripts/benchmarks/model-instructions/2026-11-14.json). No overall reliability or
speed gain follows from these changing-case runs.

The pass exposed two real input problems. Qwen encoded review actions and Studio commands as JSON
text. Dovo now accepts that metadata form and validates the canonical action before dispatch. GLM
put a target computer inside the command. Dovo now rejects that input before it can use the local
default. Put `runtimeId` beside `command`. Human review, access checks and account scope stay in
place.

Descriptions now state the required provider for child starts, wait for required answers before
workflow lookup, and show the carriage return for terminal submission. Description text is 11,219
characters for all 53 tools, compared with 11,350 at the start of this pass. Serialized catalog size
is 59,917 characters, compared with 59,915. These are character counts.

Valid-call coverage below excludes the listed pilot and ambiguous cases. A valid call does not prove
a successful task or a real effect. Every tool has a case in the matrix, but not every model
completed a valid call to every tool.

| Model    | Tools with valid calls | No included valid call                                                                   |
| -------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| deepseek | 50/53                  | `browser`, `device_forward`, `artifact_create`                                           |
| qwen     | 48/53                  | `studio_ui`, `studio_diagnostics`, `browser`, `workflow`, `artifact_create`              |
| glm      | 46/53                  | `todos`, `browser`, `workflow`, `devices`, `device`, `device_install`, `artifact_create` |

Remaining failures include extra reads, empty workflow arguments, JSON text supplied for workflow
phase arrays, an omitted child provider and LF or literal backslash-r text instead of an actual CR.
No transport fault was established for the empty arguments. Qwen and GLM correctly declined
unsupported pinch, but the narrow phrase check failed their replies. Those false negatives stay in
the raw scores. Future case generation now accepts "not available". Unit tests cover that wording
and actual CR input. No model rerun uses that phrase-check change. A history-scope case also records
an unnecessary same-Bot query. It does not show access to another Bot.

The scorer now checks target computers outside Studio wrappers and does not treat terminal command
strings as wrappers. Fixtures preserve browser state and return computer-scoped discovery results.
The report keeps frozen cases, profiles, catalogs, source versions and raw failures. Usage-cap
continuations run only the unrun case IDs. There were 210 case executions. The 500,000
reported-token soft cap, two-minute case limit and twenty-minute batch limit stay unchanged. Missing
usage remains unknown.

Verification covers 136 runtime tests, 33 benchmark tests, the runtime build and type check.
Repository checks report zero errors and 33 existing warnings. Native actions, real child work and
real reviewed commands were mocked in the model runs. Real stdio MCP and HTTP tests separately
verify encoded input, rejection before dispatch and paired-human review.

## Run the final matrix with a shared request limit

Build the runtime, then use a new output directory:

```sh
pnpm --filter @dovo/runtime... -r build
node scripts/run-final-tool-rounds.mjs \
  --directory /tmp/dovo-final-tool-rerun \
  --executable /absolute/path/to/opencode
```

This runs the current final cases on all three models with all 53 tools. It captures the catalog,
profiles, cases and source versions before the run. It refuses to overwrite a saved matrix. It uses
the configured Dovo provider through a temporary loopback proxy. It does not edit credentials or
user configuration.

The shared gate spaces actual request starts by 3.5 seconds. It allows at most 18 starts in a
rolling minute, below the provider limit of 20. Tool continuations and OpenCode retries cross the
same gate. Other applications are outside this limit. Earlier direct harness examples do not apply a
request limit unless you pass a shared proxy URL with `--provider-base-url`.

The runner keeps failed cases. A reported-token cap can split a batch, but only unrun case IDs
continue. The saved ledger excludes headers and request bodies. Historical results below retain
their frozen inputs. A new run uses the current source and can produce different results.

## Final rounds 26 through 35

Ran ten final rounds on DeepSeek, Qwen and GLM with all 53 tools in each catalog. The cases include
every tool across the matrix. They retain the corrected response fields, source evidence, computer
targets, exact content and refusal wording from earlier rounds. There were 231 case executions. The
catalog and instruction profiles stay fixed throughout these rounds. Different rounds use different
cases, so the table is not a controlled overall improvement comparison.

| Round | DeepSeek | Qwen | GLM  |
| ----- | -------- | ---- | ---- |
| 26    | 7/7      | 6/7  | 7/7  |
| 27    | 5/6      | 5/6  | 6/6  |
| 28    | 6/7      | 6/7  | 6/7  |
| 29    | 4/6      | 6/6  | 5/6  |
| 30    | 3/7      | 6/7  | 6/7  |
| 31    | 6/8      | 5/8  | 5/8  |
| 32    | 8/10     | 8/10 | 9/10 |
| 33    | 7/8      | 8/8  | 8/8  |
| 34    | 4/8      | 7/8  | 8/8  |
| 35    | 6/10     | 8/10 | 8/10 |

The benchmark now uses one shared loopback proxy for actual outbound provider requests. It spaces
starts by 3.5 seconds across all three workers, including tool continuations and provider retries.
The measured peak was 17 requests in a rolling minute, across 600 requests. The proxy observed 0
HTTP 429 responses. This gate covers these benchmark workers. Other clients remain outside it.
Existing credentials and user configuration stay in place. The ledger stores request times, methods,
paths and statuses. It excludes headers and bodies.

Workflow metadata now has visible root fields and accepts an array or its JSON encoding for phases.
The original command schema validates the result before HTTP delivery. Invalid JSON, missing fields
and fields from another action fail before dispatch. Human review and runtime permissions still
apply. History guidance now tells agents to answer from sufficient snippets and keeps user-message
IDs out of assistant response lookup. Terminal guidance specifies an actual CR, not literal
backslash text. Argument errors must not be blamed on transport without evidence.

See `finalTenToolRounds` in the
[saved report](../scripts/benchmarks/model-instructions/2026-11-14.json) for raw failures, frozen
sources, hashes, request timing and valid-call coverage. A valid call does not prove a successful
task or a real effect. All model-side MCP effects remain fixtures. Separate stdio MCP and HTTP tests
cover metadata validation. The two-minute case limit, twenty-minute batch limit and 500,000
reported-token soft cap stay unchanged. Unknown usage remains unknown.

## Repairs after the final matrix

The frozen matrix exposed three input problems. The checklist union still hid its fields at the
root. It now exposes action/items and keeps per-action validation. The MCP converter accepted an
action-incompatible field in the real HTTP test, so the tool also validates the canonical command
before dispatch.

Terminal descriptions alone did not fix LF and literal backslash-r input. The additive
terminal_input submit flag now appends one actual CR. Omit it or use false to preserve raw data.
Empty data with true sends Enter alone. Dovo never unescapes arbitrary text. Tool-session ownership
and write checks still apply.

Local child starts already required a built-in provider or a saved agent configuration. The schema
now makes that rule visible before dispatch. Explicit project/computer targets retain their existing
provider defaults. No provider is guessed for a local start.

A separate follow-up reran shared-checklist-preserve, known-terminal-lifecycle and
authorized-child-result on all three models with all 53 tools. It kept the final matrix profiles and
cases. It used the repaired catalog and production terminal helper. Main scores remain unchanged.

| Model    | Follow-up |
| -------- | --------- |
| deepseek | 3/3       |
| qwen     | 3/3       |
| glm      | 2/3       |

GLM still omitted provider for the local OpenCode child. The schema rejected it. The runtime also
returns a clear error before HTTP; no default provider is guessed. Model recovery from that error
remains unverified. The final regression run passes 183 runtime/protocol tests and 40 benchmark
tests. The runtime build and type check pass. Repository checks report zero errors and 33 existing
warnings.

The follow-up made 32 provider requests and observed 0 HTTP 429 responses. The peak across both
request ledgers was 17 starts per rolling minute. A fresh proxy started only after the last main
request had left the previous rolling window.

The final catalog has 53 tools, 11239 description characters and 60490 serialized characters. The
full instruction profile has 8255 characters. The stronger schemas add context; this pass does not
claim that the full catalog shrank. Existing budgets remain in force.

See finalTenToolRounds.postMatrixFollowup in the saved report for exact transport input, normalized
input, source snapshots, failures and unknown usage. These synthetic cases do not establish real
task success or a general model reliability gain. Real stdio MCP, HTTP and terminal WebSocket tests
separately check validation and terminal isolation.

## Matched round 36

This round compares 12 difficult cases with the current and revised instructions on all three
models. The candidate also runs 29 transfer cases per model. These cases cover every tool in the
53-tool catalog. They do not cover every action or prove behavior with real external services.

Both phases use the same frozen case file, harness and scoring rules. The strict score remains
unchanged. A second required-action score allows up to two verification reads from an explicit list.
It still rejects wrong targets, content changes outside the request, invalid arguments, failed
fixture calls, missing work, native tool attempts and dependent actions before input arrives. The
browser case accepts the fresh state from navigation without requiring another snapshot.

The revised instructions state when to stop reading, which work must wait for user input, how to
select a local child provider, and how to preserve exact artifact content. Pending private-input
results also block dependent discovery and preparation. The provider field has an OpenCode example.
The schema keeps one provider enum and excludes generic ACP for an untargeted local child. Named
agents and explicit project/computer defaults remain supported. MCP-to-HTTP tests check these
boundaries. The context budgets remain unchanged.

Three fixture limits need care. The optional theme read reports dark mode even before a write. A
model can skip the required set action because it sees the target state. The install case provides a
ready signed bundle, but it cannot serve an extra shell check of that file. Both remain in the raw
results. The plan fixture also cannot serve a verification read after a successful create/attach. Do
not count an unserved verification read as proof of a production defect or remove it to raise a
score.

The main comparison completed 159 executions. The table uses the same 12 cases per model in both
phases. Required-action scores allow the bounded verification reads described above.

| Model    | Baseline required | Candidate required | Baseline strict | Candidate strict |
| -------- | ----------------- | ------------------ | --------------- | ---------------- |
| DeepSeek | 10/12             | 12/12              | 8/12            | 11/12            |
| Qwen     | 11/12             | 10/12              | 11/12           | 10/12            |
| GLM      | 11/12             | 11/12              | 11/12           | 10/12            |

The result is mixed. DeepSeek preserved the artifact newline and performed the requested theme set.
Qwen tried extra source lookups for the skill proposal, then reached the two-minute limit. GLM
selected the skill tool directly, but its terminal case reached the same limit. The paired results
retain every gain and regression. They do not establish a general reliability gain.

The candidate's 29 transfer cases per model have no matched baseline in this round.

| Model    | Transfer required | Transfer strict | Full candidate required | Full candidate strict |
| -------- | ----------------- | --------------- | ----------------------- | --------------------- |
| DeepSeek | 28/29             | 26/29           | 40/41                   | 37/41                 |
| Qwen     | 28/29             | 28/29           | 38/41                   | 38/41                 |
| GLM      | 29/29             | 29/29           | 40/41                   | 39/41                 |

All recorded candidate calls passed argument validation. DeepSeek and GLM made valid calls to all 53
tools. Qwen made valid calls to 52 tools and did not reach propose_skill. Valid-call coverage can
include failed cases. It does not prove successful tasks.

Five candidate cases failed the required-action score. DeepSeek's plan case completed the writes,
then made the unserved verification read. Qwen skipped the device-capability check and did not
complete the skill proposal. Its computer-discovery case completed both required calls, but the
session reached the time limit before completion. GLM did not close the terminal before its time
limit. Raw stream errors, partial actions and missing usage remain recorded.

After the frozen main run, the final text names the capability action and tells models to use
supplied skill steps directly. The general call rule now includes tool setup guidance. A separate
four-case follow-up per model checks history, private-input waiting, installation and skill
proposals. It keeps the original case definitions and scoring rules. It does not replace the main
scores.

| Model    | Follow-up required | Follow-up strict |
| -------- | ------------------ | ---------------- |
| DeepSeek | 4/4                | 3/4              |
| Qwen     | 3/4                | 3/4              |
| GLM      | 4/4                | 3/4              |

All three models now call propose_skill directly. They also pass the private-input wait and
sufficient-history cases. Qwen still skips the device-capability read. DeepSeek and GLM complete the
install sequence, but each adds a verification read that fails the strict score. The follow-up does
not establish how the final text performs across the other 37 candidate cases per model.

The complete round has 171 case executions and 492 provider requests. The measured peak is 17
requests per rolling minute, with zero HTTP 429 responses. Every request has HTTP status 200. The
raw proxy ledger has 490 connection-error flags. These flags include client cancellation after a
completed SSE response. They do not establish failed model requests. A real HTTP regression test
checks this distinction. The three candidate case timeouts remain failures. Two Qwen cases and one
GLM case have no usage report. All other cases have reported usage. Token totals include only
reported usage and cannot give a complete cost comparison.

The final full instruction profile has 8,249 characters. The 53-tool catalog has 11,258 top-level
description characters and 60,518 serialized characters. The full catalog did not shrink. Existing
context budgets still pass. The runtime build, runtime type check, 183 runtime/protocol tests and 48
benchmark tests pass. Repository checks report zero errors and 33 existing warnings. These checks do
not test real external tool effects or establish a general model ranking.

See round36ToolQuality in the
[saved report](../scripts/benchmarks/model-instructions/2026-11-14.json) for both scores, raw
results, source snapshots, request ledgers and usage gaps. Prior report sections remain unchanged.
These changes stay local.

For a new comparison, build the baseline source first. Use a new directory. Change only the
production candidate between phases, then build and test it before the candidate run. Keep the case
file, harness and scoring code fixed. These commands use the current source. Historical inputs
remain in the saved report.

```sh
pnpm --filter @dovo/runtime... -r build
node scripts/run-tool-quality-round.mjs \
  --directory /tmp/dovo-tool-comparison \
  --phase baseline \
  --executable /absolute/path/to/opencode

# Apply the candidate source, build it and run its checks before continuing.
pnpm --filter @dovo/runtime... -r build
node scripts/run-tool-quality-round.mjs \
  --directory /tmp/dovo-tool-comparison \
  --phase candidate \
  --executable /absolute/path/to/opencode

# Optionally test final text changes on the four fixed follow-up cases.
# Build and test those changes first. This keeps the main scores unchanged.
node scripts/run-tool-quality-round.mjs \
  --directory /tmp/dovo-tool-comparison \
  --phase followup \
  --executable /absolute/path/to/opencode

node scripts/summarize-tool-quality-round.mjs \
  /tmp/dovo-tool-comparison /tmp/dovo-tool-comparison-summary.json
```

The driver refuses to overwrite a phase. It uses the shared provider gate and waits for the previous
phase's last request to leave the rolling window. Reported-token caps continue only unrun cases.
Failed cases stay recorded. Missing usage stays unknown. The summary checks source hashes, exact
case coverage, continuations and both request ledgers before it saves results.

## Rounds 37 through 41

Opus 5.5 reviewed the earlier failures and current instructions. The changes distinguish a confirmed
write from work that only started, keep verification for uncertain or requested outcomes, and tell
models to finish each requested step. Browser guidance now uses the state returned by an action for
verification. Repeated workflow, watch and child-tool rules stay in the matching tool descriptions.
Private-input waiting, review, access, stopped watches and exact-edit rules remain in place.

For the matched comparison, the full instruction profile falls from 8,249 to 7,612 characters, a
7.7% reduction. The 53-tool catalog stays unchanged in those two rounds. This is a character count
for the instructions, not a token or total-context saving.

Round 37 runs the current text on 12 cases per model. Round 38 repeats the same cases with the
revised text. After round 38, Dominic requested tool-description rewrites for failing cases. Rounds
39 through 41 keep coverage of 29 other cases per model and add declared retests. Later rounds can
use revised descriptions and instructions. Each captures its own source and catalog. All cases,
fixtures and scorers were fixed before round 37. The cases come from earlier runs. They are
regression coverage, not held-out tasks. All 53 tools remain available in every round. Each tool has
a case across the set. This does not cover every action. Retests do not replace earlier failures.

Both scores stay visible. The strict score uses the original rules. The separate required-action
score allows at most two named verification reads. Failed cases stay in the report. Only unrun cases
continue after a reported-token cap. Case duration includes the shared request gate, so it cannot
measure model speed alone. Unknown usage stays unknown. HTTP status and connection-error flags stay
separate because cancellation can follow completed SSE output.

The device case still requires a capability read before installation. The runtime supports install
and launch without that read. Its fixed order is stricter than the runtime boundary. The workflow
fixture still cannot serve an extra verification read after a successful write. These limits stay
visible, and their recorded failures remain unchanged. Production device guidance is unchanged in
these rounds.

Rounds 37 and 38 are complete. Required-action scores change from 10 to 11 of 12 for DeepSeek, 9 to
9 for Qwen and 9 to 11 for GLM. Strict scores change from 8 to 9, 8 to 9 and 8 to 10. These are
matched observations on previously used cases, not a general reliability estimate.

Round 39 rewrites `propose_skill` to name the required fields and draft from supplied steps. It also
puts the stopped-watch rule in `pull_request_watch` and distinguishes generic follow-up from an
explicit PR inspection request. These changes follow an Opus 5.5 read-only review of the actual
failed traces. The full instruction profile is now 7,642 characters. Top-level tool descriptions
total 11,481 characters, up from 11,258. The extra text targets observed errors. The unchanged
context budgets pass. The build, runtime type check, 138 runtime tests and 53 benchmark tests pass.

Round 39 includes the earlier skill, stopped-watch and native-install cases as declared retests. It
finishes at 12/13 required actions for DeepSeek, 11/13 for Qwen and 13/13 for GLM. All three stop at
a stopped PR watch. Qwen still reads history before proposing the skill. Its install case performs
the actions but reads capabilities after installation, which fails the frozen order. DeepSeek's
skill case reaches the deadline before any tool call.

Round 40 narrows `bot_history` to missing facts or an explicit history request. It adds both the
skill case and a positive recall case to its ten planned cases. The full profile stays at 7,642
characters. Tool descriptions total 11,556 characters. The compact catalog plus full instructions
uses 68,458 characters, compared with 68,767 at round 37. That is a 309-character reduction, about
0.45%. The shared instructions alone are 7.4% shorter. These counts are not tokenizer estimates.

The recorded `Event stream closed before completion` failures in rounds 37 through 40 all finish at
about 120 seconds. The harness combines the event stream with a 120-second abort signal. This is
evidence of the case deadline, not proof of a provider outage. The error remains in each original
result. A completed tool call can still have an unconfirmed final response. The fixed deadline and
the shared request gate also prevent a model-speed comparison.

Rounds 40 and 41 are complete. The report includes 180 case executions in the five rounds and three
separate checks of the final shorter browser description. All 53 tools were offered throughout. The
cases cover all 53 tools, but do not cover every action.

Each score cell below shows required actions followed by strict checks. The denominator is the case
count per model.

| Round                       | Cases per model | DeepSeek, required / strict | Qwen, required / strict | GLM, required / strict |
| --------------------------- | --------------: | --------------------------: | ----------------------: | ---------------------: |
| 37, baseline                |              12 |                      10 / 8 |                   9 / 8 |                  9 / 8 |
| 38, matched revision        |              12 |                      11 / 9 |                   9 / 9 |                11 / 10 |
| 39, proposal and watch cues |              13 |                     12 / 10 |                 11 / 11 |                13 / 12 |
| 40, history trigger         |              12 |                     11 / 10 |                 10 / 10 |                12 / 12 |
| 41, snapshot trigger        |              11 |                     11 / 11 |                   9 / 9 |                11 / 11 |
| Final shorter browser text  |               1 |                       1 / 1 |                   1 / 1 |                  1 / 1 |

The matched gains are specific. DeepSeek passes the native fixture order. Qwen passes private-input
waiting but loses stopped-watch follow-up. GLM passes question waiting and skill drafting. The round
39 watch rewrite passes on all three models. Later rounds have different case sets and wording, so
their totals do not measure improvement over the baseline.

The final changes target four tools:

- `propose_skill` names required fields and uses supplied steps. Source IDs cite completed work;
  Dovo validates them. Installation still needs human review in Skills.
- `bot_history` searches for missing facts or an explicit history request. Supplied steps do not
  need a lookup. All three positive recall checks in round 40 pass.
- `pull_request_watch` ends automatic follow-up after a stopped, closed or paused result. An
  explicit inspection request still permits that scoped work.
- `studio_browsers` starts with a snapshot. It answers from sufficient text and reserves `evaluate`
  for missing facts. DeepSeek previously evaluated before the snapshot. Qwen evaluated after an
  adequate snapshot. Both fail the fixture, which does not serve `evaluate`. The real runtime does
  support it. All three final retests use only list and snapshot.

Qwen calls the skill tool directly in rounds 40 and 41, but its final response still reaches the
120-second deadline. Its new-project-link case also reaches that deadline in round 41. These remain
failed cases with unconfirmed completion. No description change establishes a deadline fix. The
earlier failures remain in the saved report.

The first browser rewrite exceeded the existing full-catalog description budget by 90 characters.
The final version removes repeated guidance and passes at 10,972 characters against 11,000 for that
51-tool configuration. The 53-tool benchmark catalog has 11,537 description characters. Its compact
catalog plus full instructions uses 68,439 characters. This saves 328 characters against round 37,
about 0.48%. The shared instructions alone save 7.4%. These are character counts, not measured
token, cost or speed gains.

The source check also detected a capture mistake. I rebuilt the browser module while round 41 was
active. The last three batches captured its shorter description source while using the original
saved catalog. The collector verifies that all other module bytes match. It preserves both hashes
and records each difference in `sourceDrift`. It rejects any other module change. The separate final
follow-up captures and tests the exact shorter text. This limitation stays visible rather than
rewriting a phase snapshot or raw result.

The shared proxy recorded 534 provider requests, with a maximum of 18 in a rolling minute. It
recorded zero HTTP 429 or other HTTP error responses. Its connection-error flags include cancelled
SSE output and do not establish provider failures. The provider limit is 20 calls per minute. This
gate covers the benchmark workers only.

The final runtime build, runtime type check, 138 runtime tests and 55 benchmark tests pass. The
[warning audit](repository-warning-audit.md) records all 33 existing warnings, 108 additional tests
and three native Electron checks. No warning rule was disabled.

The [saved report](../scripts/benchmarks/model-instructions/2026-11-15.json) contains strict and
required-action scores, all failed cases, captured inputs, source hashes, four Opus 5.5 reviews,
usage gaps and the request ledger. The earlier `2026-11-14.json` report is unchanged.

To run a phase, build the runtime first. Use the source version captured for that phase when
repeating the historical comparison. Use a fresh output directory. The driver refuses to replace an
existing phase. These commands show the final retests and collector:

```sh
pnpm --filter @dovo/runtime... -r build
node scripts/run-reviewed-tool-rounds.mjs \
  --directory work/model-instruction-benchmark/rounds37-41 \
  --round 39 \
  --extra-cases stopped-pr-watch,native-discovery-install,bot-skill-proposal \
  --executable /absolute/path/to/opencode
node scripts/run-reviewed-tool-rounds.mjs \
  --directory work/model-instruction-benchmark/rounds37-41 \
  --round 40 --extra-cases bot-skill-proposal,bot-history-recall \
  --executable /absolute/path/to/opencode
node scripts/run-reviewed-tool-rounds.mjs \
  --directory work/model-instruction-benchmark/rounds37-41 \
  --round 41 --extra-cases bot-skill-proposal,signed-in-tab-snapshot \
  --executable /absolute/path/to/opencode
node scripts/run-reviewed-tool-rounds.mjs \
  --directory work/model-instruction-benchmark/rounds37-41 \
  --round 41 --followup --extra-cases signed-in-tab-snapshot \
  --executable /absolute/path/to/opencode
node scripts/summarize-reviewed-tool-rounds.mjs \
  work/model-instruction-benchmark/rounds37-41 \
  scripts/benchmarks/model-instructions/2026-11-15.json
```

The commands above refuse to replace the completed evidence in this checkout. A new experiment also
needs rounds 37 and 38 before the later phases. Real models made these choices. Tool effects were
fixtures. No external task outcome was verified. Changes stay local.
