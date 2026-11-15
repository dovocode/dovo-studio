# Tool descriptions and selection checks

Tool descriptions now start with the task they solve. They state the first action or required ID
before less common details. Related tools point to each other where the choice matters. For example,
`browser` handles isolated web tests, while `studio_browsers` handles signed-in Dovo tabs.

The text keeps stable retry IDs, human review, access limits, secret handling, history exclusions
and untrusted-content rules. Tool availability and access defaults do not change.

Across the 51-tool full catalog, top-level description text decreased from 12,656 to 10,991
characters, about 13.2%. This is a character count, not a model token count. Some descriptions grew
where their old first sentence did not explain their purpose.

## Argument schemas

Five tools had also lost their argument fields during the Effect update. `strictStruct` validates
unknown input before decoding it. JSON Schema export described that unknown input instead of its
declared fields. This affected `thread_prepare`, `response_prepare`, `automation_list`,
`automation_prepare` and `workflow`.

These tools now advertise their plain-data shape. The runtime still checks the original command. The
stdio catalog regression checks required fields, nested actions, allowed calls and extra-field
rejection. The context budget stays in place.

Private-input destinations accept a structured object or its JSON encoding. Qwen supplied the
encoded form in saved OpenCode tool calls, which OpenCode rejected before MCP. Dovo now decodes that
one metadata field and validates the original command before it reaches the review service.
Malformed destinations fail before a request appears. Credential values never enter these tool
arguments. The real MCP-to-HTTP test covers both forms, private delivery to stdin and invalid input.

Later [model instruction checks](model-instruction-benchmark.md) removed the conflicting advice to
check private delivery immediately. The description tells agents to wait after confirmed pending
input. Explicit status requests and unknown outcomes still use `status`.

The later MCP result also returns `deliveryCompleted` and next-step guidance. Pending results tell
agents to finish independent work and return for the completion message. Cancelled or failed
delivery keeps dependent work blocked. This changes model-facing results, while the HTTP status
contract and human review stay unchanged.

Those checks also found empty GLM arguments for the private-input and project-link unions. Both
schemas now expose their fields at the root and retain their original per-action validation. A
shared checkout definition avoids repeating its shape. These layout changes add 1,154 schema
characters compared with round 6. The existing context budgets still pass. The initial wording
comparison below remains unchanged.

The later instruction rounds also test exact artifact edits. Qwen removed a final newline while
changing one day name. The artifact update description now calls out final newlines and untouched
content. This adds 13 characters after the initial description comparison. The later focused checks
also state when to skip workflow lookups and wait for input before preparation. These two workflow
descriptions and first-page cursor rule add 30 more characters. The original results below remain
unchanged. See the
[continued instruction checks](model-instruction-benchmark.md#rounds-11-through-15).

## Live comparison

The benchmark uses the actual OpenCode CLI and the configured provider. All Dovo MCP actions use
mocks. It creates temporary OpenCode sessions and a temporary directory. It denies native tools,
records calls, then interrupts and removes each session. No workflow, device, secret-input request
or terminal action runs.

The 16 cases cover device discovery, both browser types, CI watches, user questions, workflow lookup
and review, thread review, Memory, installed help, response lookup, private input, checklists,
terminal names and two cases that need no tool.

Compare the original and revised descriptions with the same corrected argument schemas. This keeps
schema repair separate from wording changes. A correct case needs the expected first MCP tool, valid
arguments and the expected action and known IDs. The report counts extra calls separately. It also
records timeouts and failed requests. AJV validates the mock call arguments.

This is a small selection check with synthetic tasks. It does not measure completed real tasks,
permission compliance during real work or statistical reliability. Scores use the calls that reach
the mock MCP server. Diagnostic runs also record saved OpenCode tool attempts and final text. Failed
calls that OpenCode rejects before MCP can therefore require separate inspection. The reports record
provider token totals when available and use `null` for unknown usage. Time and case limits remain
active. The reported-token cap is only useful when a provider returns usage.

## Results, 14 November 2026

The comparison used OpenCode CLI 2.3.0. Each model ran all 16 cases for each wording version. The
reported-token cap split each version into two batches.

| Model                               | Original wording | First revision |
| ----------------------------------- | ---------------- | -------------- |
| `dovo/deepseek-v4.1-flash:dev:prio` | 16/16            | 16/16          |
| `dovo/qwen3.8-27b:dev:prio`         | 15/16            | 13/16          |

Qwen's first revision added an unnecessary lookup when the workflow ID was known, and supplied both
URL and run IDs for a watch. The final wording states when to call workflow preparation directly and
requires one watch selector. Both versions failed Qwen's private-input case.

After those fixes, both models passed all three targeted cases: CI watch, known workflow and private
input. Each used one valid call. DeepSeek sent a destination object. Qwen sent its JSON encoding,
which the production decoder converted to the same validated command. This final check uses the
updated destination schema. It is not a repeat of the full 16-case wording comparison.

Saved OpenCode tool attempts confirmed that Qwen encoded the private-input destination as a string.
An object example alone did not fix this. The final schema accepts either form, and the mock uses
the production decoder before scoring the canonical command. Reports retain the original transport
arguments as well.

These results do not establish a general increase in tool use. Keep the shorter copy and clear entry
instructions, and test model-specific failures separately. Raw comparison scores are in
[`2026-11-14.json`](../scripts/benchmarks/tool-descriptions/2026-11-14.json).

## Run the checks

Build before capturing tools:

```sh
pnpm --filter @dovo/runtime... -r build
node scripts/benchmark-tool-descriptions.mjs --capture /tmp/dovo-tool-catalog.json
node --test scripts/benchmark-tool-descriptions.test.mjs
pnpm exec vp test --maxWorkers=2 packages/runtime/src/agent-tools
```

Live runs use the local OpenCode configuration and can incur provider charges. Pass the installed
OpenCode executable explicitly:

```sh
node scripts/benchmark-tool-descriptions.mjs --run \
  --catalog /tmp/dovo-tool-catalog.json \
  --output /tmp/dovo-deepseek-tool-selection.json \
  --model dovo/deepseek-v4.1-flash:dev:prio \
  --executable /absolute/path/to/opencode

node scripts/benchmark-tool-descriptions.mjs --run \
  --catalog /tmp/dovo-tool-catalog.json \
  --output /tmp/dovo-qwen-tool-selection.json \
  --model dovo/qwen3.8-27b:dev:prio \
  --executable /absolute/path/to/opencode
```

Use `--cases native,review-workflow` to select a subset. A run has a 20-minute deadline, a
two-minute limit per case and a soft cap of 500,000 reported tokens. An in-flight request can exceed
that cap. The benchmark stops if it cannot confirm session cleanup.

## All-tool follow-up

Ten more rounds use all 53 tools on DeepSeek, Qwen and GLM. Descriptions name the required fields
and the next useful action. They keep access checks, private-input rules and human review.
Description text is 131 characters shorter. The full serialized catalog stays about the same size.

Qwen supplied review actions and Studio commands as JSON text. Dovo now decodes those metadata
fields and validates the original command. A computer target inside a Studio command now fails
before dispatch. It must stay beside `command`.

See the [all-tool results](model-instruction-benchmark.md#all-tool-rounds-16-through-25) for raw
scores, fixture limits and remaining model errors. Use `--capture --all-tools` to include Bot
history, skill proposals and all four Memory scopes. Model runs use fixtures for actions. Separate
MCP and HTTP tests cover validation and human review.

## Rules from the full set of runs

Use the task and required input at the start of each description. Use known IDs directly. Name the
related discovery tool only when an ID is missing. Keep direct answers available when supplied facts
are enough. More tool calls do not make a better result.

Show action fields at the schema root. Text examples cannot fix fields that the model cannot see.
Keep action-specific validation too. Accept JSON text only for metadata fields where recorded calls
show a need. Decode it with the production helper and validate the canonical command. Keep original
transport arguments in the benchmark report. Never decode arbitrary terminal text or secret values.

State what a result confirms. Pending input, a timed-out child wait and an uncertain watch request
are separate states. Each needs its own next step. Do not turn a pending result into success or poll
it after the tool confirms that a later message will arrive.

Test exact content and action order as well as tool selection. A valid tool call can still remove a
final newline, use the wrong computer, submit the wrong terminal byte or add work outside the
request. Retain those failures and provider errors in the raw results. Keep fixture limits beside
the scores.

Limit actual provider requests across workers. Counting cases misses tool continuations and provider
retries. The final runner uses one shared proxy and leaves user credentials and configuration
intact.

## Final ten-round validation

The final matrix completed 231 cases with all 53 tools on DeepSeek, Qwen and GLM. Its 600 provider
requests peaked at 17 per rolling minute, with zero HTTP 429 responses. A separate three-case repair
check scored DeepSeek 3/3, Qwen 3/3 and GLM 2/3. GLM still omitted the child provider. Validation
rejects that input; it does not guess a provider.

The repairs expose workflow/checklist fields, accept validated encoded phase metadata, add explicit
terminal submission and state the existing local child-provider requirement. Strict MCP field checks
and canonical checklist validation run before HTTP dispatch. Final checks pass 183 runtime/protocol
tests, 40 benchmark tests, the runtime build and type check. Repository checks report zero errors
and 33 existing warnings. Context budgets stay unchanged.

See the [final results](model-instruction-benchmark.md#final-rounds-26-through-35) for scores,
frozen sources, raw failures and the mocked-effect limit. Changes remain local.

## Matched round 36

This round adds a matched comparison on 12 cases per model and 29 transfer cases per model. A
separate four-case follow-up checks the final text. The changes name setup prerequisites, show the
local OpenCode provider value, and tell models to use supplied skill steps directly. They also
preserve exact edits, stop unnecessary reads and block dependent work while input is pending. Human
review and access rules stay in place. Context budgets still pass.

The candidate passes 118/123 required-action checks and 114/123 strict checks. Matched results are
mixed. DeepSeek improves, Qwen loses one required-action pass, and GLM keeps the same
required-action score. The final follow-up passes 11/12 required-action checks and 9/12 strict
checks. All three models now select propose_skill directly. Qwen still skips the device-capability
check. Keep this failure visible rather than adding more text to chase a perfect score.

The full round uses 492 provider requests, with a peak of 17 per rolling minute and no HTTP 429
responses. Connection-error flags include cancelled SSE streams and do not measure failed model
requests. See the [matched results](model-instruction-benchmark.md#matched-round-36) for raw
failures, strict scores, usage gaps, verification and fixture limits. Real models made these
choices. Tool effects were simulated. Changes remain local.

## Five rounds with Opus 5.5 review

Rounds 37 through 41 and a separate three-case follow-up are complete. They contain 183 case
executions with all 53 tools offered. The changes clarify skill proposal fields, limit Bot history
to missing facts or requested recall, stop automatic PR follow-up after a stopped watch, and use
sufficient browser snapshot text without another read. Shared guidance also separates a confirmed
write from work that only started.

The matched required-action totals change from 28/36 to 31/36. Qwen's result is mixed, so this does
not establish a general reliability gain. All three final browser retests pass. Qwen's skill and
project-link completions still reach the fixed 120-second deadline. Preserve these failures.

The shared instructions are 7.4% shorter. The final compact catalog plus instructions saves only 328
characters, about 0.48%, because targeted tool descriptions add useful cues. The unchanged context
budgets pass. The request ledger records 534 requests, a peak of 18 per rolling minute and no HTTP
429 responses.

See the [results and limits](model-instruction-benchmark.md#rounds-37-through-41) for both scores,
the saved source-capture drift, exact final-text follow-up and simulated-effect limit. Build,
runtime types, 138 runtime tests and 55 benchmark tests pass. The
[33-warning audit](repository-warning-audit.md) records separate source and native Electron checks.
Changes remain local.
