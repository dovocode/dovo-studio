# PR-Agent source investigation

Dovo uses its own review pipeline. It does not install, import or run PR-Agent. The source
investigation used upstream commit
[`ef5a40031b21658e4657db44d6618e22db34ed8b`](https://github.com/The-PR-Agent/pr-agent/tree/ef5a40031b21658e4657db44d6618e22db34ed8b).
No upstream dependencies or commands ran. The implementation below uses existing Dovo services and
contracts. This investigation does not compare real model accuracy.

## What makes a review useful

A longer prompt alone cannot supply missing callers or prevent unsupported findings. The useful
upstream work sits around the model call. It prepares code evidence, budgets the full input, retains
coverage, and checks proposed findings.

| Inspected source                                                                                                                                                                                                                                                                            | Observation                                                                                                                                                                            | Dovo decision                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Reviewer prompt](https://github.com/The-PR-Agent/pr-agent/blob/ef5a40031b21658e4657db44d6618e22db34ed8b/pr_agent/settings/pr_reviewer_prompts.toml)                                                                                                                                        | Uses PR intent, concrete failure scenarios, exact code, confidence and controls for false positives.                                                                                   | Capture title and body. Require a concrete trigger, impact and fix. Ask the model to trace contracts and failure paths. Reject claims about code outside the supplied evidence.                                                       |
| [Reviewer command](https://github.com/The-PR-Agent/pr-agent/blob/ef5a40031b21658e4657db44d6618e22db34ed8b/pr_agent/commands/pr_reviewer.py#L1457)                                                                                                                                           | Splits large diffs, retains successful chunk results and tracks omitted or failed coverage. It also filters low-confidence findings.                                                   | Pack whole patches into up to four batches automatically. Keep successful batches after a failure. Offer an explicit pass for failed and remaining files.                                                                             |
| [Diff preparation](https://github.com/The-PR-Agent/pr-agent/blob/ef5a40031b21658e4657db44d6618e22db34ed8b/pr_agent/algo/pr_processing.py) and [patch context](https://github.com/The-PR-Agent/pr-agent/blob/ef5a40031b21658e4657db44d6618e22db34ed8b/pr_agent/algo/git_patch_processing.py) | Budget and order patches. Extend code context with alignment checks.                                                                                                                   | Preserve complete hunks. Add bounded whole-file Git snapshots where available. Keep patch lines as the authority for finding locations.                                                                                               |
| [Repository context](https://github.com/The-PR-Agent/pr-agent/blob/ef5a40031b21658e4657db44d6618e22db34ed8b/pr_agent/algo/repo_context.py)                                                                                                                                                  | Supports bounded context at pinned refs and optional relative import expansion.                                                                                                        | Read changed source files and heuristic relative JS/TS imports from captured commits. Never read dirty working files for PR evidence. Show the exact snapshots in the report.                                                         |
| [Token budgets](https://github.com/The-PR-Agent/pr-agent/blob/ef5a40031b21658e4657db44d6618e22db34ed8b/pr_agent/algo/token_budget.py)                                                                                                                                                       | Counts rendered prompts and reserves output space for each model.                                                                                                                      | Count serialized evidence, including line labels and JSON escaping. Apply separate input and output caps. Dovo does not have one tokenizer contract across all coding providers, so these are character limits, not token guarantees. |
| [Finding merge](https://github.com/The-PR-Agent/pr-agent/blob/ef5a40031b21658e4657db44d6618e22db34ed8b/pr_agent/algo/review_merge.py) and [suggestion checks](https://github.com/The-PR-Agent/pr-agent/blob/ef5a40031b21658e4657db44d6618e22db34ed8b/pr_agent/algo/suggestion_checks.py)    | Normalize findings, remove duplicates and check suggested code.                                                                                                                        | Validate exact changed-line evidence in code. Remove exact duplicate findings. Sort by severity and confidence. Do not apply generated patches.                                                                                       |
| [Suggestion reflection prompt](https://github.com/The-PR-Agent/pr-agent/blob/ef5a40031b21658e4657db44d6618e22db34ed8b/pr_agent/settings/code_suggestions/pr_code_suggestions_reflect_prompts.toml)                                                                                          | A separate pass challenges generated code suggestions against the evidence. This belongs to the suggestions flow. It does not establish that every upstream `/review` uses reflection. | Run a fresh challenge pass for supported PR findings. Require one decision for every candidate. Reject missing decisions, duplicates, invented IDs and weak findings.                                                                 |
| [Structural reach](https://github.com/The-PR-Agent/pr-agent/blob/ef5a40031b21658e4657db44d6618e22db34ed8b/pr_agent/algo/structural_reach.py)                                                                                                                                                | Can use explicit build-graph input. It does not create complete repository understanding by itself.                                                                                    | Keep the relative import reader small. Do not call it build-graph analysis or claim full caller coverage.                                                                                                                             |

## Native review design

The entry action stays simple. Choose a reviewer once, then start later reviews with one action.
Batching, context reads, code checks and the challenge pass happen inside that action. Neither
client adds a wizard for review depth.

Both model phases use fresh sessions with tools disabled. They do not inherit repository settings or
agent resources. The runtime reads Git objects through the existing bounded preview service. Code,
PR text and finding text remain untrusted evidence. A second model pass can still repeat the first
model's mistake. Confidence and exact quotes do not prove a defect.

Keep explicit publication, exact draft preview and account/revision guards. Do not add automatic
approval, merge scores, repository-controlled execution, automatic PR triggers or a second provider
framework. Keep the existing conversation action for investigation with tools and wider repository
context when a human wants it.

## Limits and next evidence

- Four batches can leave large PRs partly uncovered. Files in separate batches are not analyzed
  together. Very large single patches need investigation in a conversation.
- Local Git context can be absent, too large or incomplete. URL-only reviews use patches only.
  Relative imports do not cover aliases, all language imports, reverse callers or a full build
  graph.
- Character caps do not prove a selected model can accept the input. Provider failures stay visible.
  No fallback changes the selected reviewer without a user action.
- The challenge pass adds model calls. It uses the selected model in a fresh session. It is not an
  independent provider or a real test run.
- Verification covers engine behavior, real Git snapshot reads, storage, request guards and adapted
  desktop/mobile interfaces. It does not establish accuracy on real PRs. A useful next quality check
  needs a labelled set of PR defects and false positives, with the same models before and after.

See [Agent PR review](pr-code-review.md) for setup, exact limits, recovery and verification
commands.
