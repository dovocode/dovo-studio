# Workspace classifier hardening

Integration follow-up: the post-trained run-09 export is now wired into runtime packaging and the
[unified starter](unified-workspace.md). The training-only measurements and historical production
status below describe the experiment before that integration.

Fine-tuned on Dominic's Mac Studio (M4 Max, 128 GiB), 2026-11-04. The selected run-09 checkpoint
reaches **3,327/3,330 native validation questions (99.91%)**. Its compressed export scores
**1,460/1,461 synthetic regression questions (99.93%)**, versus 1,450/1,461 for run 04. On the fresh
50-prompt test it gets **49/50 complete suggestions (98%)**, versus 42/50 for run 04. These results
do **not** establish 99.9% real-world reliability or calibrated per-prompt certainty.

The complete bundle is **206,295,753 bytes (206.3 MB)**; the compressed archive is 177,812,998
bytes. This is a research artifact. Production still uses Julia-1; no application code,
dependencies, release settings or phone installation changed. The
[earlier artifact](workspace-selection-training.md) and intermediate candidates are preserved.

## Behavior and limits

One catalog-conditioned GLiClass model chooses Browser, Terminal or Thread, then suggests the
computer and the relevant model, project or browser profile. It returns supplied IDs only. Routing
remains entirely model-based: no shell/URL checks, confidence fallback or cloud model calls.

The confirmed policy is that “Could Opus handle this bug fix?” retains the current model, while
“Could you use Opus to fix this bug?” selects Opus. Both exact cases pass. Generalization is
imperfect: “Should I use Opus for code reviews?” incorrectly selects Opus in run 09. The 20-prompt
capability suite scores 19/20, compared with 20/20 for run 08 and 18/20 for run 04. Run 09 improves
other routing cases while introducing that advice-question regression.

The [inference contract](workspace-selection-training.md#contract) is unchanged: 2–16 choices per
question, 384 tokens including labels/instructions, explicit rejection of oversized input, and
visible editable overrides when integrated. A suggestion needs three or four model calls. The
classifier does not extract URLs, clean terminal commands, execute anything or implement pickers.
Catalog filtering by computer and production handling of empty/single-option catalogs remain
integration work. Storage near 200 MB does not imply a 200 MB RAM footprint. Phone inference has not
been measured.

## Training

Base: `knowledgator/gliclass-base-v3.0`, revision `77a70e6cd52e602ed18184ef37d18bdd3741e3d5`,
186,545,922 parameters. All continuations use full FP32 weights on Apple MPS, batch size 32, AdamW,
weight decay 0.01, 10% linear warmup/decay, gradient clipping at 1.0 and seed 20261106. Each run
initializes from the previous selected checkpoint. Checkpoint selection uses validation accuracy,
then cross-entropy, with the unmodified initialization retained as an epoch-zero candidate. Neither
manual tests nor synthetic test scores select epochs.

| Run | Training / validation questions | Epochs completed / planned | Learning rate | Selected validation |
| --- | ------------------------------: | -------------------------: | ------------: | ------------------: |
| 05  |                   8,955 / 2,604 |                      3 / 6 |          1e-5 |       2,482 / 2,604 |
| 06  |                   9,675 / 2,784 |                      4 / 4 |          5e-6 |       2,719 / 2,784 |
| 07  |                  10,475 / 2,961 |                      1 / 3 |          5e-6 |       2,952 / 2,961 |
| 08  |                  10,715 / 3,021 |                      3 / 3 |          4e-6 |       3,017 / 3,021 |
| 09  |                  12,021 / 3,330 |                      2 / 2 |          3e-6 |       3,327 / 3,330 |

Run 05 was stopped after validation plateaued despite very low training loss. Run 06 broadened
current-selection versus named-selection contrasts. Run 07 added polite navigation and
unavailable-version/alias contrasts; it was stopped after the user clarified capability-question
semantics. Its reported validation score uses the earlier policy.

Run 08 adds 240 capability-versus-use training examples and corrects **20 validation labels** per
that clarification. This label correction is a policy change, **not a training accuracy gain**. Run
09 adds contextual command help, quoted command arguments, the `file` utility, mode words requested
as text, project advice versus actual project work, and project navigation without an address. It
takes 460.8 seconds, selects epoch 1, and keeps all picker tasks correct on native validation. Its
three validation misses are mode-word requests in English/Dutch and “open the app in a browser.”
These are development diagnostics, not independent production estimates.

All datasets, checkpoints, logs and full raw evaluation observations remain under:

```text
/Users/dominic/.dovo/model-training/workspace-router-2026-11-04/selections-20261104
```

## Evaluation discipline

The original 1,461-question synthetic test is byte-for-byte unchanged. Exact benchmark and manual
inputs are excluded from gradient training, and input texts do not cross data splits. Broader error
families from observed tests informed refinement, so old suites are regression checks even when
exact strings remain excluded. Synthetic examples share generation structure and option-label
conventions; their accuracy should not be presented as a production success rate.

The [100-prompt set](../scripts/benchmarks/workspace-selection-blind-v2.json), with new catalog
names, was frozen before its first run-08 evaluation: 98/100 complete suggestions versus 87/100 for
run 04. Its failures informed run 09, so its later 99/100 result is a regression score. The
[50-prompt set](../scripts/benchmarks/workspace-selection-blind-v3.json) was frozen before run-09
results, with different catalogs, and remained unchanged after evaluation. It scores 49/50 versus
42/50 for run 04. These small authored tests exercise generalization but cannot substantiate 99.9%
accuracy across real user inputs. Hashes and the pre-evaluation checkpoint freeze are retained in
[the results directory](../scripts/benchmarks/workspace-routing-results/2026-11-04-gliclass-hardened).

| Quantized bundle measurement     |        Run 04 |        Run 09 | Interpretation                                         |
| -------------------------------- | ------------: | ------------: | ------------------------------------------------------ |
| Original synthetic questions     | 1,450 / 1,461 | 1,460 / 1,461 | Regression                                             |
| Fresh 50 complete suggestions    |       42 / 50 |       49 / 50 | Fresh final test                                       |
| Fresh 50 field questions         |     168 / 180 |     178 / 180 | Includes two absent fields after one wrong destination |
| Earlier 100 complete suggestions |      87 / 100 |      99 / 100 | Regression after run-08 feedback                       |
| Capability policy scenarios      |       18 / 20 |       19 / 20 | Policy regression                                      |
| 16-option catalog scenarios      |       16 / 18 |       18 / 18 | Catalog regression                                     |
| Original manual scenarios        |       31 / 32 |       32 / 32 | Development regression                                 |
| Earlier manual holdout           |       17 / 18 |       17 / 18 | Regression                                             |
| Later new-catalog holdout        |       16 / 16 |       16 / 16 | Regression                                             |

Complete suggestions use actual destination-first inference: a wrong destination also skips the
expected pickers. Separate Python field-question measurements ask every expected field and may
therefore score differently. Both report forms are retained; question accuracy must not be
substituted for complete-suggestion success.

Known run-09 failures include:

- `Can you show https://gallery.sunbird.org in Culture?` selects Thread instead of Browser.
- `Should I use Tourmaline Code 1 for Brook Finance? I only want advice` selects the named model and
  project instead of keeping both.
- `Should I use Opus for code reviews?` selects Opus instead of keeping the current model.
- The synthetic test's `quartz.tools` selects Thread instead of Browser.
- The older regression's `hello` selects Terminal instead of Thread.

## Export and verification

The selected FP32 checkpoint was frozen before final test inspection. Export uses ONNX opset 17 and
standard `DequantizeLinear`, symmetric row-wise int8 weights along axis 0, with FP32 activations and
computation. The official standalone `@huggingface/tokenizers` 0.2.0 module and upstream licenses
accompany the model. There are no new production dependencies.

The
[asset manifest](../scripts/benchmarks/workspace-routing-results/2026-11-04-gliclass-hardened/assets.json)
records every bundled file, dataset/source/checkpoint hashes and archive integrity. All 11 archive
files and the remote model match the manifest on Mac Studio. The final archive exists locally at
`work/gliclass-selections/dovo-workspace-selections-gliclass-hardened-20261104.tar.gz` and on Mac
Studio under the training directory above. Original run-04 and intermediate run-08 archives remain
intact.

Archive SHA-256: `2f1ab28d5524a58d6b8c49c4c4d4b8c21955e7d359bc8b6b3d3a14c95051ebcf`.

Native FP32, FP32 ONNX and row-wise int8 agree on all **2,570 evaluated questions** across the 11
Python suites. The app's Node ORT 1.23.2 on Linux and Python ORT 1.31.1 on Mac agree on all **541
checked decisions**, with identical token IDs. That sample includes all 180 fresh manual questions,
80 capability questions, 63 catalog-stress questions, and 218 synthetic questions (40 randomly
sampled per task, every mistake and the 20 smallest logit margins, deduplicated). These are export
checks; they do not make the model's known wrong decisions correct.

Isolated Mac CPU inference, four threads and ten complete-proposal warmups, measures **122 ms median
/ 160 ms p95** on the original manual scenarios, with **1.033 GB peak process RSS**. The 16-option
stress set measures **149 ms median / 195 ms p95**, with 1.035 GB peak RSS. No training libraries
are loaded for these timings. Linux Node portability checks measure roughly 151–156 ms median per
field question and 909–921 MB peak RSS. Different hardware and runtimes make those portability
timings unsuitable for a controlled performance comparison.

Older routing evaluation scores 89/90 versus run 04's 90/90; the challenge improves from 87/90 to
89/90; the original regression remains 24/25. Full mistakes, timings and cross-platform observations
are retained in the run-09 reports in the results directory. Browser UI, production integration and
physical-phone inference were not tested in this training-only follow-up.

## Reproduction

Use the existing isolated Mac research environment and
[pinned requirements](../scripts/benchmarks/workspace-routing-results/2026-11-04-gliclass-hardened/requirements.lock.txt).
No application package installation is required. Generate revisions 05–09 from the preserved run-04
dataset with the following cumulative flags:

| Dataset | Additional flags                                                |
| ------- | --------------------------------------------------------------- |
| v5      | None                                                            |
| v6      | `--extra-intent-contrasts`                                      |
| v7      | Also `--broad-navigation-language --unavailable-model-versions` |
| v8      | Also `--capability-is-discussion`                               |
| v9      | Also `--contextual-help`                                        |

```sh
python scripts/benchmarks/harden-workspace-selection-training.py \
  --base-data work/workspace-selection-training/dataset-v4.json \
  --extra-intent-contrasts --broad-navigation-language --unavailable-model-versions \
  --capability-is-discussion --contextual-help \
  --output work/workspace-selection-training/dataset-v9.json
caffeinate -i python scripts/benchmarks/train-workspace-gliclass.py train \
  --base /path/to/run-08/checkpoint \
  --data work/workspace-selection-training/dataset-v9.json \
  --benchmark scripts/benchmarks/workspace-routing-cases.json \
  --output /path/to/run-09 --epochs 2 --batch-size 32 \
  --learning-rate 0.000003 --retain-baseline
```

For earlier runs, use the table's parent, data revision, epoch count and learning rate. For stopped
trials retain the planned epoch count, which controls the schedule, and stop after the recorded
completed validation epoch. Stopped-trial reports preserve those details.

Use `export` and `evaluate` with the same base/data/benchmark/output arguments; omit training-only
flags. Evaluation supports `--suite test`, `regression`, `evaluation`, `challenge` with
`--challenge`, and `acceptance` with `--acceptance`. Each acceptance run writes
`evaluation-acceptance.json`; rename it before evaluating the next file. The earlier report explains
Node/Python export verification and isolated full-proposal benchmarking.
