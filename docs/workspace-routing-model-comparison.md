# Workspace routing model comparison

Measured 2026-11-04. **GLiClass v4 Edge is the strongest accuracy candidate tested.** Its reference
and full-precision ONNX export both score 82/90, versus Kev's 71/90 and the shipped Julia's 33/90.
The official quantized export falls to 42/90, so it must not be substituted on the assumption that
it preserves reference quality. This comparison does not change Julia, production dependencies,
routing behavior or releases.

The subsequent [Mac Studio fine-tuning run](./workspace-router-training.md) produces an
approximately 206 MB GLiClass base-v3 bundle and improves the original evaluation to 89/90. The
tables below remain the earlier baselines; the training report includes fresh tests, export fidelity
and CPU portability.

## Scope and method

The destination is chosen entirely by the model: Browser for literal addresses, Terminal for literal
commands, Thread for questions and requests. There are no URL/shell rules, confidence fallbacks or
executed commands. For example, `git diff` belongs to Terminal, while “explain git diff” belongs to
Thread. The visible destination override remains necessary.

The [corpus](../scripts/benchmarks/workspace-routing-cases.json) contains 25 regression cases and 90
separate evaluation cases: 30 addresses, 30 commands and 30 thread inputs. It includes LAN/VPN HTTP
addresses, pipes, custom CLIs, requests mentioning commands/URLs, multilingual text and instruction
overrides. These are hand-written diagnostic cases, not a representative traffic sample or a general
model benchmark. Evaluation cases exclude the ten prompt examples; regression results overlap
examples and should not be used to rank models.

Julia uses the actual compiled production adapter and its three existing descriptions. Laya and Kev
use their native choice interfaces with the same descriptions, prefixed by the destination names,
and no demonstrations. Instruction models use the same minimal instruction, ten interleaved
examples, greedy generation and a one-token B/T/C output constraint. The logits choose the
destination; that output constraint contains no routing logic. Qwen3 thinking is disabled. This
compares usable configurations, not identical architectures or training recipes. Exact prompts,
options, revisions and hashes are in the saved results.

The follow-up tests GLiClass with an explicit routing instruction and the same three descriptions,
DeBERTa by ranking entailment for the three descriptions, and SetFit/MiniLM after training on only
the ten shared prompt examples. SetFit uses one contrastive body-training epoch, 400 generated pairs
and a learned logistic-regression head, with seed 42. Training took approximately 11 seconds;
inference was measured in a fresh process loading the saved checkpoint. No evaluation examples or
labels were used for training or checkpoint selection. Ten examples are a few-shot baseline, not
evidence of SetFit's ceiling with a larger routing dataset.

## Results

Intel i7-13700T, Linux x64, four inference threads, sequential requests. Median/p95 cover the 90
evaluation inputs after a warmup and regression pass. Different backends make latency a deployment
observation, not a controlled architecture comparison. No Mac, GPU or phone timing was measured.
Mobile currently routes through its selected paired runtime.

| Configuration                           |   Correct / 90 | Browser / 30 | Terminal / 30 | Thread / 30 | Median / p95 | Assets, decimal MB |
| --------------------------------------- | -------------: | -----------: | ------------: | ----------: | -----------: | -----------------: |
| Kev-0.8B, official PyTorch FP32         | **71 (78.9%)** |           29 |            25 |          17 | 510 / 793 ms |              1,805 |
| Kev-0.6B, ONNX q4                       |     58 (64.4%) |           26 |            24 |           8 | 166 / 203 ms |                383 |
| Laya 421M, PyTorch FP32                 |     58 (64.4%) |           24 |            24 |          10 | 212 / 298 ms |                846 |
| Laya multilingual 322M, PyTorch FP32    |     58 (64.4%) |           21 |            26 |          11 |   62 / 73 ms |                678 |
| Laya typed-decisions 421M, PyTorch FP32 |     57 (63.3%) |           23 |            21 |          13 | 170 / 258 ms |                846 |
| Qwen3-0.6B, ONNX int8                   |     48 (53.3%) |           14 |            15 |          19 | 645 / 967 ms |                627 |
| SmolLM2-360M-Instruct, ONNX int8        |     48 (53.3%) |           23 |            18 |           7 | 357 / 448 ms |                367 |
| Qwen2.5-0.5B-Instruct, ONNX int8        |     42 (46.7%) |           12 |            18 |          12 | 540 / 746 ms |                519 |
| Julia-1 144M, shipped ONNX FP32         |     33 (36.7%) |           16 |            14 |           3 |   24 / 29 ms |                617 |

The requested follow-up alternatives:

| Configuration                                    | Correct / 90 | Browser / 30 | Terminal / 30 | Thread / 30 |   Median / p95 | Assets, decimal MB |
| ------------------------------------------------ | -----------: | -----------: | ------------: | ----------: | -------------: | -----------------: |
| GLiClass v4 Edge 440M, PyTorch FP32              |   82 (91.1%) |           30 |            28 |          24 | 605 / 1,174 ms |                890 |
| GLiClass v4 Edge 440M, official ONNX FP32        |   82 (91.1%) |           30 |            28 |          24 |   353 / 548 ms |              1,770 |
| GLiClass v4 Edge 440M, ONNX FP32 + ten examples  |   69 (76.7%) |           30 |            27 |          12 | 990 / 1,088 ms |              1,770 |
| GLiClass v4 Edge 440M, official ONNX q8          |   42 (46.7%) |            9 |             9 |          24 |   175 / 266 ms |                655 |
| DeBERTa-v3-base zero-shot v2, 184M, PyTorch FP32 |   66 (73.3%) |           30 |            27 |           9 |   221 / 382 ms |                378 |
| SetFit/MiniLM-L6 23M, ten training examples      |   59 (65.6%) |           18 |            18 |          23 |   5.4 / 8.5 ms |                 92 |

GLiClass's native and FP32 ONNX predictions match on all 115 regression/evaluation inputs. Its
official q8 export changes 58/115 predictions. Both exports and the original weights match their
pinned upstream SHA-256s; token IDs for the ONNX input formatter were checked against the official
Python pipeline for all 115 inputs. This isolates the quality gap to the q8 artifact in this
configuration, rather than missing assets or different tokenization. It does not establish whether
quantization alone, or another export difference, caused it. No export was repaired here. The
PyTorch reference timing includes a second tokenization used for that parity assertion; the ONNX
measurements use one tokenization per request. Python process RSS includes imported research
frameworks and should not be interpreted as the memory of a future Node deployment. Adding the ten
shared examples to GLiClass through its native example format reduces accuracy from 82/90 to 69/90
and increases latency; this configuration is not recommended.

Asset sizes sum the exact files hashed in the results, before compression. They exclude native
libraries, Python, packaging metadata and license files; these are not measured installer sizes.
Laya source weights are FP16 but were evaluated with its official FP32 CPU reference. Laya 0.3.20
automatically normalizes the multilingual tokenizer configuration's `extra_special_tokens` list to a
named mapping for Transformers compatibility; its vocabulary and model weights match upstream. No
automatic language router was used.

Kev-0.8B's loaded text model and pointer head have **752,917,824 parameters**, within the 0.8B
limit. The downloaded base checkpoint also contains unused vision weights, included in the 1,805 MB
source-asset figure. A text-only merged/quantized export was not built or measured. The reference
uses CPU fallbacks for causal convolution and Gated DeltaNet, not optimized CUDA kernels. Its peak
process RSS was approximately 4.8 GiB; the shipped Julia benchmark peaked at approximately 0.73 GiB.
Prefix caching and native Apple acceleration were not evaluated.

## Failures that matter

Julia and Qwen2.5 route `ls -la` to Browser. Kev-0.6B routes it to Thread. Both Laya variants, Laya
typed-decisions, Qwen3, SmolLM2 and Kev-0.8B route it correctly to Terminal.

Kev-0.8B still sends “What does ls -la do?”, “Please explain the output of git diff” and “Write a
shell script to back up my files” to Terminal. It sends “Help me debug localhost:8080” to Browser
and `pwd` to Thread. It misses 13/30 thread inputs, including an instruction override. A correct
suggestion for one command does not resolve the general routing problem.

GLiClass correctly handles `ls -la`, `pwd` and explanations such as “What does ls -la do?”. Its
zero-shot FP32 configuration still sends `go test ./...` and `codex resume session-id` to Thread,
“Summarize https://developer.mozilla.org” to Browser, and “Run npm install and investigate the
error” to Terminal. It also misroutes all three instruction-override inputs in this corpus. DeBERTa
gets only 9/30 thread cases right; SetFit's ten-example model sends `ls -la` to Thread.

Recommendation: investigate a smaller GLiClass export that preserves the FP32 predictions before
replacing Julia. The current verified FP32 graph is about 1.77 GB including its tokenizer, so the
quantized graph cannot be chosen just for its smaller footprint. SetFit/MiniLM is a useful second
direction if low CPU latency and a small bundle matter most, but it needs more varied training data.
Collect a larger fresh evaluation set and measure on Mac before choosing a production replacement.
This supersedes the earlier recommendation to use Kev as the next training baseline; it does not
establish what any candidate would achieve after further tuning.

## NVIDIA AlpaJudge screening

The requested [nvidia/alpajudge](https://huggingface.co/nvidia/alpajudge) was inspected at revision
`f1557d146af66b7f4b240a62432136bb3463be54`; it was **not benchmarked as a router**. The
[official inference contract](https://github.com/NVlabs/alpajudge) describes a judge for
autonomous-driving explanations:

- Reference-based: a DeBERTa answer-alignment model taking a question, reference answer and
  candidate answer, returning one alignment probability. It does not offer direct three-way
  destination selection; feeding the known destination as a reference would leak the answer.
- Reference-free: a Qwen3-VL-2B backbone taking six camera frames, ego actions and a rationale. It
  exceeds the parameter budget and requires inputs absent from the workspace.

This rules it out as a drop-in router. It does not claim the reference-based encoder could never be
repurposed with additional training. Its weights use OpenMDW-1.1. DeBERTa zero-shot declares MIT;
the other evaluated base model cards declare Apache-2.0.

## Reproduction and evidence

The [saved summary](../scripts/benchmarks/workspace-routing-results/2026-11-04/summary.json)
contains pinned model revisions, precise prompts, per-class confusion matrices, asset SHA-256s,
load/first-inference/warm timings and process memory. The adjacent `observations.csv` records every
prediction and request timing; `caseIndex` is zero-based within the corresponding corpus split.
`asset-verification.json` records upstream LFS hash matches and the official Laya loader's
configuration normalization. Model weights and isolated runtime installations are not committed.

The
[follow-up results](../scripts/benchmarks/workspace-routing-results/2026-11-04-alternatives/summary.json)
use the same corpus hash and CSV format. They include training provenance for SetFit and upstream
asset verification for the new candidates.

The [JavaScript harness](../scripts/benchmark-workspace-routers.mjs) runs Julia, causal models and
Kev-0.6B ONNX. Install Transformers.js **3.8.1** outside the project and pass its
`dist/transformers.node.mjs` path. It uses that installation's native ONNX Runtime **1.21.0** for
Kev as well; loading a different ONNX native library in the same process can cause symbol conflicts.
Julia runs its own production ONNX Runtime **1.23.2** in a separate process.

```sh
node scripts/benchmark-workspace-routers.mjs --julia --name Julia-1 \
  --directory packages/runtime/dist/models/workspace-router \
  --revision 82a2fadf8fccfccdc5fd4e1009ba8f1a265eb7a8 --output /tmp/julia-routing.json

node scripts/benchmark-workspace-routers.mjs --name Qwen3-0.6B-int8 \
  --directory /path/to/pinned-qwen3-snapshot \
  --transformers /path/to/isolated/transformers/dist/transformers.node.mjs \
  --revision 58ca03a5e7b354b480b1a82b34bde8dc7b854cc0 --output /tmp/qwen-routing.json
```

Use `--kev` for the official Kev-0.6B q4 ONNX snapshot. Download the model files listed in the
summary from their exact revisions first; inference uses local files only. Prepare/build the
production runtime and Julia assets through the existing repository commands before its run.

The [Python reference harness](../scripts/benchmarks/workspace-routing-reference.py) uses an
isolated Python 3.12 environment with Torch **2.15.0+cpu**, Transformers **5.22.1**, Laya
**0.3.20**, PEFT **0.21.0** and Accelerate **1.15.0**. Laya runs with
`--backend laya --directory SNAPSHOT --name NAME --revision SHA --output REPORT`. Kev runs with
`--backend kev`, its adapter `--directory`, a local `--base`, and `--kev-source` pointing to
official source commit `2074cc44256200bb37540103fa4572901faa10f3`. Put that SHA in its `REVISION`
file. Include `kev/model.py`, `checkpoint.py`, `shared_prefix.py` and `__init__.py`. The original
base revision is recorded in the results; the harness substitutes only its local snapshot path. It
uses the checkpoint's merged adapter and native pointer-head inference, never expected labels.

For the follow-up, install GLiClass **0.1.22**, SetFit **1.2.0**, Sentence Transformers **6.2.0**,
scikit-learn **1.9.1**, Datasets **5.1.0** and ONNX Runtime **1.31.1** in the isolated research
environment. Use `--backend gliclass` for the reference, or `--backend gliclass-onnx` with
`--onnx-precision fp32|q8` for the official graphs. `--examples` adds the same ten prompt examples
using GLiClass's official example formatter. Use `--backend deberta` for the NLI classifier. All
accept the same `--directory`, `--name`, `--revision` and `--output` arguments.

[Train SetFit](../scripts/benchmarks/train-workspace-setfit.py) with a pinned local MiniLM snapshot
and a new output directory; it refuses to overwrite a prior training run:

```sh
python scripts/benchmarks/train-workspace-setfit.py --directory /path/to/minilm-snapshot \
  --revision 1110a243fdf4706b3f48f1d95db1a4f5529b4d41 --output /tmp/dovo-setfit-run
python scripts/benchmarks/workspace-routing-reference.py --backend setfit \
  --directory /tmp/dovo-setfit-run --name SetFit-MiniLM-L6-10examples \
  --revision 1110a243fdf4706b3f48f1d95db1a4f5529b4d41 --output /tmp/setfit-routing.json
```

The saved `routing-training.json` captures training examples, hyperparameters and package versions.
Benchmarking checks again that none of those examples occurs in evaluation. Loading the trained head
uses only the locally produced checkpoint; no third-party pickle classifier was downloaded.

All nine original and six follow-up configurations completed both corpus splits, recording 1,725
predictions in total. The GLiClass few-shot input formatter also matches the official pipeline's
token IDs and attention masks on all 115 inputs. A second Laya multilingual run through the final
reference harness reproduced every prediction; median/p95 were 83/130 ms, illustrating that the
latency figures are individual runs, not stable hardware guarantees. JavaScript scoped lint/format
checks and Python syntax validation passed. Production app, native mobile behavior and a deployable
Kev-0.8B export were not exercised by this research.
