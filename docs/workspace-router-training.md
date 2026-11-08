# Trained GLiClass workspace router

Trained on Dominic's Mac Studio on 2026-11-04. The approximately **206 MB** bundle contains a
fine-tuned `knowledgator/gliclass-base-v3.0` model, tokenizer, configuration and license texts. It
chooses Browser, Terminal or Thread entirely through learned logits. This experiment does not
replace the application's Julia router, change production dependencies or publish a release.

The final bundle is **206,293,835 bytes** unpacked; the verified `.tar.gz` is **177,814,101 bytes**.
The archive is available on Mac Studio at
`/Users/dominic/.dovo/model-training/workspace-router-2026-11-04/dovo-workspace-router-gliclass-int8-20261104.tar.gz`
and in this checkout under `work/gliclass-training/`. The
[asset manifest](../scripts/benchmarks/workspace-routing-results/2026-11-04-trained-gliclass/assets.json)
and
[summary](../scripts/benchmarks/workspace-routing-results/2026-11-04-trained-gliclass/summary.json)
contain individual file hashes, archive SHA-256 and exact sizes.

## Training

The Mac Studio has an Apple M4 Max and 128 GiB unified memory. Full FP32 training ran on its MPS
GPU: 1,296 synthetic examples, batch size 16, four epochs, AdamW at `2e-5`, weight decay `0.01`, 10%
linear warmup and linear decay, gradient norm capped at 1.0, seed `20261104`. Training and
validation took 94 seconds. Epoch 3 was selected by validation accuracy, with cross-entropy as the
tie-breaker. The original GLiClass base has 186,545,922 parameters and is pinned to
`77a70e6cd52e602ed18184ef37d18bdd3741e3d5`.

[The generator](../scripts/benchmarks/build-workspace-router-training.py) produces balanced
training, validation (636 examples) and test (648 examples) splits. Each split uses distinct command
strings, host names and request templates, including some unseen utilities. Some utilities and
structural generation templates are shared between splits. All inputs in the earlier benchmark are
excluded. Commands are strings only; training and evaluation never execute them or open input
addresses.

The data distinguishes literal invocations from requests about invocations, addresses from requests
about websites, natural-language instructions, multilingual requests and routing instruction
overrides. These are synthetic diagnostic sets, not a representative sample of real usage. The
[fresh 90-case challenge](../scripts/benchmarks/workspace-router-challenge.json) was authored before
inspecting the trained model's test/benchmark results. No second training run was performed after
observing failures. Export formats were adjusted after testing portability; the weights and selected
epoch did not change.

The training script computes three-way cross-entropy from the model's logits explicitly: GLiClass
0.1.22's uni-encoder built-in single-label loss leaves its internal `num_labels` at `-1`. The loaded
model has no calibrator. The bundle's scores should not be presented as calibrated probabilities.

## Measured quality

| Suite                                 | Final bundle correct | FP32 checkpoint correct |
| ------------------------------------- | -------------------: | ----------------------: |
| Validation (used for epoch selection) |            634 / 636 |               634 / 636 |
| Separate synthetic test               |            638 / 648 |               637 / 648 |
| Earlier manual evaluation             |              89 / 90 |                 89 / 90 |
| Fresh manual challenge                |              86 / 90 |                 85 / 90 |
| Earlier regression                    |              24 / 25 |                 24 / 25 |

The FP32 ONNX graph agrees with native PyTorch on all 1,489 decisions. Row-wise compression changes
two decisions across those cases. On the earlier evaluation the shipped Julia baseline scored 33/90.
This is a useful diagnostic improvement, not a measured production success rate.

Known failures include bare `codex` (Thread), `hello` (Terminal), a command followed by a problem
description, and a host address followed by “refuses the connection.” Several unseen “Help: COMMAND
isn't working” requests still go to Terminal. The visible destination override remains necessary.
The classifier does not execute anything itself.

Isolated Mac CPU inference (four threads, 10 warmups, 90 requests) measures **36.7 ms median, 40.8
ms p95**, including Rust tokenization, int64 feeds and argmax. That process peaks at about 1.04 GB
RSS without importing PyTorch. The complete paired-reference evaluation has concurrent native
inference and should not be used as an isolated throughput benchmark. Phone timing was not measured;
mobile currently routes through the selected paired runtime.

The bundled tokenizer and the app's `onnxruntime-node` 1.23.2 on Linux x64 agree with Mac Python on
**all 1,489 decisions**, with no tokenizer mismatches. Node inference measures 137 ms median / 191
ms p95 on this Linux host (four threads) and peaks at approximately 915 MB RSS. These are different
machines and backends, not a controlled CPU architecture comparison.

## Export and portability

The bundle uses standard ONNX per-axis `DequantizeLinear`: large constant tensors are stored as
symmetric int8 with a separate scale for each row, along axis 0. Activations and computation remain
FP32. The graph has dynamic batch/sequence dimensions and opset 17. The exact prefix, ordered labels
and input/output names are in `routing.json`. Input is tokenized as `prefix + input`, with no
heuristics or text sanitization. The research checker rejects sequences over 256 tokens rather than
silently truncating them. A production adapter still needs defined long-input/error behavior.

This checkpoint contains very large outlier weights, especially in down-projection matrices.
Whole-tensor quantization destroyed accuracy, and dynamic activation/output-channel quantization
produced inconsistent results across CPU configurations. Those exports were rejected. Row-wise
weight compression isolates those outliers while keeping the bundle near the requested size. The
graph dequantizes weights for float computation; **a 206 MB file does not imply a 206 MB memory
footprint**. It is a storage optimization, not a claim of accelerated integer inference.

The bundled, unmodified `@huggingface/tokenizers` 0.2.0 module is self-contained and has no runtime
dependencies. It matches Python token IDs for all 1,489 evaluated inputs. The older Transformers.js
3.8.1 tokenizer disagreed on one special-token input and is not used in this bundle. Python ORT and
the app's native ORT are verified independently; full per-input observations and hashes live in
[the saved results](../scripts/benchmarks/workspace-routing-results/2026-11-04-trained-gliclass).

## Reproduction

Use an isolated Python 3.12 environment with the pinned
[requirements](../scripts/benchmarks/workspace-routing-results/2026-11-04-trained-gliclass/requirements.lock.txt).
Download the pinned base snapshot's JSON, safetensors and tokenizer files into `base`. The Mac's
training directory is `/Users/dominic/.dovo/model-training/workspace-router-2026-11-04`; its
`run-01` retains the FP32 checkpoint, intermediate graphs, dataset, logs and final bundle. The model
assets and environments are ignored by Git; scripts, datasets and measured reports are repository
files.

From the checkout:

```sh
python scripts/benchmarks/build-workspace-router-training.py
python scripts/benchmarks/train-workspace-gliclass.py train \
  --base /path/to/base \
  --data work/workspace-router-training/dataset.json \
  --benchmark scripts/benchmarks/workspace-routing-cases.json \
  --output /path/to/new-run
python scripts/benchmarks/train-workspace-gliclass.py export \
  --base /path/to/base \
  --data work/workspace-router-training/dataset.json \
  --benchmark scripts/benchmarks/workspace-routing-cases.json \
  --output /path/to/new-run
python scripts/benchmarks/train-workspace-gliclass.py evaluate \
  --base /path/to/base \
  --data work/workspace-router-training/dataset.json \
  --benchmark scripts/benchmarks/workspace-routing-cases.json \
  --challenge scripts/benchmarks/workspace-router-challenge.json \
  --output /path/to/new-run
```

Training deliberately requires MPS and a fresh output directory. Copy the official Tokenizers.js
0.2.0 `dist/tokenizers.mjs` to `bundle/tokenizer.mjs`, its license and the upstream Apache/MIT
notices into the bundle before packaging. Install research tools outside the pnpm workspace.

For Node verification, create a reference JSON array from the Mac's evaluated observations. Each row
contains `input`, `expected`, Python's `actual` destination and `logits`, and Python token IDs under
`ids`. The checker uses the app's existing `onnxruntime-node` 1.23.2, rejects tokenization
differences and records any decision changes across hosts:

```sh
node scripts/benchmarks/check-workspace-gliclass-export.mjs \
  --directory /path/to/bundle \
  --reference /path/to/node-reference-row-wise.json \
  --output /path/to/node-evaluation.json
```
