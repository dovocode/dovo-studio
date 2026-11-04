"""Train/evaluate a research-only GLiClass router on Mac Studio, then export ONNX.

Dependencies live in an isolated Python environment, not the application. Labels
come only from the dataset. No example input is executed and no routing rules run.
"""

import argparse
import hashlib
import json
import math
import os
import platform
import random
import shutil
import statistics
import time
from importlib.metadata import version
from pathlib import Path

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", USE_TF="0")

import numpy as np
import torch
from gliclass import GLiClassModel, ZeroShotClassificationPipeline
from transformers import AutoTokenizer


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["train", "export", "evaluate"])
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--benchmark", type=Path, required=True)
    parser.add_argument("--challenge", type=Path, help="Optional fresh test set; never used for training/selection")
    parser.add_argument("--acceptance", type=Path, help="Optional full-prompt/catalog acceptance cases; evaluation only")
    parser.add_argument("--suite", choices=["validation", "test", "regression", "evaluation", "challenge", "acceptance"],
                        help="Evaluate just one suite, writing evaluation-SUITE.json")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--retain-baseline", action="store_true",
                        help="Keep initialization if every trained epoch has worse validation results")
    args = parser.parse_args()
    data = json.loads(args.data.read_text())
    benchmark = json.loads(args.benchmark.read_text())
    labels = data["labels"]
    prefix = "".join("<<LABEL>>" + x for x in data["labelDescriptions"]) + "<<SEP>>" + data["instruction"]
    max_length = data.get("maxLength", 256)
    max_options = data.get("maxOptions", 3)

    def options(record):
        return record.get("options", [dict(id=key, label=label)
                                      for key, label in zip(labels, data["labelDescriptions"])])

    def instruction(record):
        return data.get("tasks", {}).get(record.get("task", "destination"), {}).get(
            "instruction", data["instruction"])

    def format_record(record):
        if isinstance(record, str):
            record = {"text": record}
        choices = options(record)
        assert 2 <= len(choices) <= max_options
        assert len({choice["id"] for choice in choices}) == len(choices)
        return "".join("<<LABEL>>" + choice["label"] for choice in choices) + "<<SEP>>" + instruction(record) + record["text"]
    torch.set_num_threads(8)
    torch.set_num_interop_threads(1)
    seed = data["seed"]
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.backends.mps.is_available():
        torch.mps.manual_seed(seed)
    versions = {name: version(name) for name in [
        "torch", "transformers", "gliclass", "onnx", "onnxruntime", "tokenizers",
    ]}

    # Guard both between-split overlap and leakage from the previous benchmark.
    benchmark_inputs = {text.strip().casefold() for group in benchmark.values() if isinstance(group, list)
                        for text, _ in group}
    seen = set()
    split_inputs = set()
    for records in data["splits"].values():
        current_inputs = set()
        for record in records:
            text_key = record["text"].strip().casefold()
            assert text_key not in benchmark_inputs | split_inputs, f"Leaked input: {record['text']}"
            key = (record.get("task", "destination"), text_key,
                   json.dumps(record.get("options"), sort_keys=True))
            assert key not in seen, f"Duplicate question: {record['text']}"
            seen.add(key)
            current_inputs.add(text_key)
        split_inputs.update(current_inputs)
    assert digest(args.benchmark) == data["benchmarkSha256"]

    tokenizer_path = args.base if args.action == "train" else args.output / "checkpoint"
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_path, local_files_only=True)

    def encode(texts, tensors="pt"):
        encoded = tokenizer([format_record(text) for text in texts], padding=True, return_tensors=tensors)
        assert encoded["input_ids"].shape[-1] <= max_length, "Refuse silent truncation"
        return {key: value for key, value in encoded.items() if key in ["input_ids", "attention_mask"]}

    def summarize(observations):
        matrix = {actual: {predicted: 0 for predicted in labels} for actual in labels}
        by_task = {}
        for row in observations:
            task = row.get("task", "destination")
            counts = by_task.setdefault(task, {"correct": 0, "total": 0})
            counts["total"] += 1
            counts["correct"] += row["expected"] == row["actual"]
            if task == "destination":
                matrix[row["expected"]][row["actual"]] += 1
        correct = sum(r["expected"] == r["actual"] for r in observations)
        cases = {}
        for row in observations:
            if row.get("caseId") is not None:
                cases.setdefault(row["caseId"], []).append(row)
        return {"correct": correct, "total": len(observations), "accuracy": correct / len(observations),
                "confusion": matrix, "byTask": by_task,
                **({"completePlans": {"correct": sum(all(r["actual"] == r["expected"] for r in rows)
                                                       for rows in cases.values()), "total": len(cases)}} if cases else {}),
                "mistakes": [r for r in observations if r["actual"] != r["expected"]]}

    def targets_for(batch):
        return torch.tensor([[c["id"] for c in options(r)].index(r["destination"]) for r in batch], device="mps")

    def mask_choices(logits, batch):
        counts = torch.tensor([len(options(r)) for r in batch], device=logits.device)
        return logits.masked_fill(torch.arange(max_options, device=logits.device)[None, :] >= counts[:, None], -1e9)

    if args.action == "train":
        if args.output.exists():
            parser.error("Use a fresh output directory; training never overwrites a previous run")
        if not torch.backends.mps.is_available():
            parser.error("This run is required to train on the Mac Studio GPU; MPS is unavailable")
        args.output.mkdir(parents=True)
        shutil.copy2(args.data, args.output / "dataset.json")
        model = GLiClassModel.from_pretrained(args.base, local_files_only=True, dtype=torch.float32)
        initialization_sha256 = digest(args.base / "model.safetensors")
        model.config.problem_type = "single_label_classification"
        model.config.max_num_classes = max_options
        assert model.calibrator is None, "Do not silently train beneath an old calibrator"
        assert model.config.prompt_first and model.config.architecture_type == "uni-encoder"
        # Native loss in this GLiClass version leaves num_labels=-1 on the
        # uni-encoder path. Compute the same three-way CE explicitly from logits.
        model.to("mps")
        train = data["splits"]["train"]
        validation = data["splits"]["validation"]
        for records in [train, validation]:
            for record in records:
                encode([record])
        optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.01)
        steps = math.ceil(len(train) / args.batch_size) * args.epochs
        warmup = max(1, round(steps * 0.1))
        scheduler = torch.optim.lr_scheduler.LambdaLR(
            optimizer, lambda step: min((step + 1) / warmup, max(0, (steps - step) / (steps - warmup)))
        )

        @torch.no_grad()
        def validate():
            model.eval()
            observations, losses = [], []
            for offset in range(0, len(validation), args.batch_size):
                batch = validation[offset:offset + args.batch_size]
                x = {k: v.to("mps") for k, v in encode(batch).items()}
                targets = targets_for(batch)
                logits = mask_choices(model(**x, max_num_classes=max_options).logits, batch)
                assert logits.shape == (len(batch), max_options) and torch.isfinite(logits).all()
                losses.append((torch.nn.functional.cross_entropy(logits, targets).item(), len(batch)))
                predictions = logits.argmax(-1).cpu().tolist()
                observations.extend({"input": r["text"], "task": r.get("task", "destination"),
                                     "expected": r["destination"], "actual": options(r)[p]["id"]}
                                    for r, p in zip(batch, predictions))
            result = summarize(observations)
            result["loss"] = sum(loss * n for loss, n in losses) / len(validation)
            return result

        started = time.perf_counter()
        baseline = validate()
        print(json.dumps({"event": "baseline", "validation": baseline}), flush=True)
        history, best, global_step = [], (-1, float("-inf")), 0
        if args.retain_baseline:
            best = (baseline["accuracy"], -baseline["loss"])
            model.save_pretrained(args.output / "checkpoint")
            tokenizer.save_pretrained(args.output / "checkpoint")
            write_json(args.output / "selected.json", {"epoch": 0, "validation": baseline})
        for epoch in range(args.epochs):
            model.train()
            indices = list(range(len(train)))
            random.shuffle(indices)
            for offset in range(0, len(indices), args.batch_size):
                batch = [train[i] for i in indices[offset:offset + args.batch_size]]
                x = {k: v.to("mps") for k, v in encode(batch).items()}
                targets = targets_for(batch)
                optimizer.zero_grad(set_to_none=True)
                logits = mask_choices(model(**x, max_num_classes=max_options).logits, batch)
                loss = torch.nn.functional.cross_entropy(logits, targets)
                assert torch.isfinite(loss), "Non-finite training loss"
                loss.backward()
                norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, foreach=False)
                assert torch.isfinite(norm), "Non-finite gradients"
                optimizer.step()
                scheduler.step()
                global_step += 1
                if global_step % 10 == 0:
                    print(json.dumps({"event": "step", "step": global_step, "steps": steps,
                                      "epoch": epoch + 1, "loss": loss.item(),
                                      "elapsedSeconds": time.perf_counter() - started}), flush=True)
            result = validate()
            history.append({"epoch": epoch + 1, **result})
            print(json.dumps({"event": "validation", "epoch": epoch + 1, "result": result}), flush=True)
            score = (result["accuracy"], -result["loss"])
            if score > best:
                best = score
                model.save_pretrained(args.output / "checkpoint")
                tokenizer.save_pretrained(args.output / "checkpoint")
                write_json(args.output / "selected.json", {"epoch": epoch + 1, "validation": result})
            write_json(args.output / "history.json", history)
        torch.mps.synchronize()
        metadata = {
            "baseRepository": data["baseRepository"], "baseRevision": data["baseRevision"],
            "initializationPath": str(args.base), "initializationSha256": initialization_sha256,
            "datasetSha256": digest(args.data), "benchmarkSha256": digest(args.benchmark),
            "seed": seed, "epochs": args.epochs, "batchSize": args.batch_size,
            "learningRate": args.learning_rate, "optimizer": "AdamW", "weightDecay": 0.01,
            "schedule": "10% linear warmup, linear decay", "gradientNorm": 1.0,
            "device": "Apple MPS", "machine": platform.machine(), "macOS": platform.mac_ver()[0],
            "parameters": sum(p.numel() for p in model.parameters()), "dtype": "float32",
            "maxOptions": max_options, "maxLength": max_length,
            "retainBaseline": args.retain_baseline,
            "trainingSeconds": time.perf_counter() - started, "versions": versions,
            "baselineValidation": baseline,
            "selection": "Validation accuracy, then validation cross-entropy. No test/benchmark checkpoint selection.",
        }
        write_json(args.output / "training.json", metadata)
        print(json.dumps({"event": "complete", "metadata": metadata}), flush=True)
        return

    checkpoint = args.output / "checkpoint"
    if args.action == "export":
        import onnx
        from onnx import TensorProto, helper, numpy_helper
        from onnxruntime.quantization.quant_utils import quantize_data
        from onnxruntime.quantization.shape_inference import quant_pre_process

        bundle = args.output / "bundle"
        bundle.mkdir(exist_ok=False)
        model = GLiClassModel.from_pretrained(checkpoint, local_files_only=True, dtype=torch.float32).eval()
        class Wrapper(torch.nn.Module):
            def __init__(self, model):
                super().__init__()
                self.model = model

            def forward(self, input_ids, attention_mask):
                return self.model(input_ids=input_ids, attention_mask=attention_mask, max_num_classes=max_options).logits

        x = encode(["ls -la", "What does a shell do?"])
        with torch.no_grad():
            torch.onnx.export(
                Wrapper(model), (x["input_ids"], x["attention_mask"]), str(args.output / "model-fp32.onnx"),
                input_names=["input_ids", "attention_mask"], output_names=["logits"],
                dynamic_axes={"input_ids": {0: "batch", 1: "sequence"},
                              "attention_mask": {0: "batch", 1: "sequence"}, "logits": {0: "batch"}},
                opset_version=17, dynamo=False, external_data=False,
            )
        quant_pre_process(args.output / "model-fp32.onnx", args.output / "model-pre.onnx",
                          skip_symbolic_shape=True)
        # Outlier input channels make whole-tensor/output-channel quantization
        # lose much of this DeBERTa checkpoint. Store each input row separately
        # in signed int8, using standard per-axis ONNX DQ and FP32 activations.
        # ORT supplies the quantization math; no custom runtime or packed format.
        graph = onnx.load(str(args.output / "model-pre.onnx"))
        initializers, dequantizers, residuals = [], [], []
        for tensor in graph.graph.initializer:
            if tensor.data_type != TensorProto.FLOAT or len(tensor.raw_data) < 100_000:
                initializers.append(tensor)
                continue
            values = numpy_helper.to_array(tensor)
            parts = [quantize_data(row, TensorProto.INT8, symmetric=True) for row in values]
            zero = np.asarray([part[0] for part in parts], dtype=np.int8)
            scale = np.asarray([part[1] for part in parts], dtype=np.float32)
            quantized = np.stack([part[2] for part in parts])
            packed, scale_name, zero_name = (tensor.name + suffix for suffix in ["_weight_q8", "_weight_scale", "_weight_zero"])
            initializers.extend([numpy_helper.from_array(quantized, packed),
                                 numpy_helper.from_array(np.asarray(scale, dtype=np.float32), scale_name),
                                 numpy_helper.from_array(np.asarray(zero, dtype=np.int8), zero_name)])
            dequantizers.append(helper.make_node("DequantizeLinear", [packed, scale_name, zero_name],
                                                 [tensor.name], name=tensor.name + "_weight_dequantize", axis=0))
            residuals.append({"name": tensor.name, "elements": int(values.size)})
        nodes = list(graph.graph.node)
        del graph.graph.initializer[:]
        graph.graph.initializer.extend(initializers)
        del graph.graph.node[:]
        graph.graph.node.extend(dequantizers + nodes)
        onnx.save(graph, str(bundle / "model.onnx"))
        onnx.checker.check_model(str(bundle / "model.onnx"))
        tokenizer.save_pretrained(bundle)
        shutil.copy2(checkpoint / "config.json", bundle / "config.json")
        write_json(bundle / "routing.json", {
            "labels": labels, "labelDescriptions": data["labelDescriptions"],
            "instruction": data["instruction"], "prefix": prefix, "maxLength": max_length,
            "inputNames": ["input_ids", "attention_mask"], "outputName": "logits",
            "decision": "argmax over supplied choices only; no rules or confidence fallback",
            "maxOptions": max_options, "tasks": data.get("tasks", {}),
            "baseRepository": data["baseRepository"], "baseRevision": data["baseRevision"],
            "trainingDatasetSha256": digest(args.data), "license": "Apache-2.0",
            "quantization": {"weights": "symmetric row-wise int8, DequantizeLinear axis=0",
                             "activations": "float32",
                             "quantizedTensors": len(residuals),
                             "quantizedElements": sum(t["elements"] for t in residuals),
                             "minimumTensorBytes": 100_000},
        })
        print(json.dumps({"event": "export", "bundleBytes": sum(p.stat().st_size for p in bundle.iterdir())}), flush=True)
        return

    import onnxruntime as ort

    bundle = args.output / "bundle"
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = 4
    session_options.inter_op_num_threads = 1
    sessions = {
        "fp32": ort.InferenceSession(str(args.output / "model-fp32.onnx"), sess_options=session_options,
                                     providers=["CPUExecutionProvider"]),
        "q8": ort.InferenceSession(str(bundle / "model.onnx"), sess_options=session_options,
                                   providers=["CPUExecutionProvider"]),
    }
    # Confirm manual formatter against the native pipeline, not a second copy.
    native = GLiClassModel.from_pretrained(checkpoint, local_files_only=True, dtype=torch.float32).eval()
    pipe = ZeroShotClassificationPipeline(native, tokenizer, classification_type="single-label",
                                          device="cpu", max_length=max_length, progress_bar=False)
    suites = {s: rows for s, rows in data["splits"].items() if s != "train"}
    suites.update({s: [{"text": text, "destination": destination} for text, destination in benchmark[s]]
                   for s in ["regression", "evaluation"]})
    if args.challenge:
        challenge = json.loads(args.challenge.read_text())
        training_inputs = {r["text"].strip().casefold() for r in data["splits"]["train"]}
        assert all(text.strip().casefold() not in training_inputs for text, _ in challenge["cases"])
        suites["challenge"] = [{"text": text, "destination": destination}
                               for text, destination in challenge["cases"]]
    if args.acceptance:
        acceptance = json.loads(args.acceptance.read_text())
        training_inputs = {r["text"].strip().casefold() for r in data["splits"]["train"]}
        suites["acceptance"] = []
        for i, case in enumerate(acceptance["cases"]):
            assert case["text"].strip().casefold() not in training_inputs
            for task, expected in case["expected"].items():
                record = {"text": case["text"], "destination": expected, "task": task, "caseId": i}
                if task != "destination":
                    record["options"] = acceptance["catalogs"][task]
                assert expected in [c["id"] for c in options(record)]
                suites["acceptance"].append(record)
    if args.suite:
        assert args.suite in suites, "Requested suite is unavailable"
        suites = {args.suite: suites[args.suite]}
    report_path = args.output / (f"evaluation-{args.suite}.json" if args.suite else "evaluation.json")
    results = {"machine": platform.platform(), "versions": versions, "cpuThreads": 4, "suites": {}}
    if args.challenge:
        results["challengeSha256"] = digest(args.challenge)
    if args.acceptance:
        results["acceptanceSha256"] = digest(args.acceptance)
    for session in sessions.values():
        for _ in range(3):
            session.run(["logits"], encode(["ls -la"], "np"))
    for suite, rows in suites.items():
        observations = {"fp32": [], "q8": []}
        changed, native_disagreements, max_error = [], [], 0.0
        for row in rows:
            text, expected = row["text"], row["destination"]
            choices = options(row)
            inputs = encode([row], "np")
            official = pipe.pipe.prepare_inputs([text], [choice["label"] for choice in choices], same_labels=True,
                                                prompt=instruction(row))
            assert all(np.array_equal(inputs[k], official[k].numpy()) for k in inputs)
            with torch.no_grad():
                native_logits = native(**official, max_num_classes=max_options).logits.numpy()[0][:len(choices)]
            scores = {}
            for name, session in sessions.items():
                started = time.perf_counter()
                # Include tokenization once in each timed request.
                logits = session.run(["logits"], encode([row], "np"))[0][0][:len(choices)]
                ms = (time.perf_counter() - started) * 1000
                assert logits.shape == (len(choices),) and np.isfinite(logits).all()
                actual = choices[int(logits.argmax())]["id"]
                scores[name] = actual
                observations[name].append({"input": text, "expected": expected, "actual": actual,
                                            "ms": ms, "logits": logits.tolist(),
                                            "task": row.get("task", "destination"), "options": choices,
                                            "caseId": row.get("caseId"),
                                            "ids": inputs["input_ids"][0].tolist()})
                if name == "fp32":
                    max_error = max(max_error, float(np.max(np.abs(logits - native_logits))))
                    if int(logits.argmax()) != int(native_logits.argmax()):
                        native_disagreements.append(text)
            if scores["fp32"] != scores["q8"]:
                changed.append(text)
        summary = {}
        for name, obs in observations.items():
            timing = sorted(r["ms"] for r in obs)
            summary[name] = {**summarize(obs), "medianMs": statistics.median(timing),
                             "p95Ms": timing[math.ceil(len(timing) * .95) - 1], "observations": obs}
        results["suites"][suite] = {
            **summary, "fp32NativeDisagreements": native_disagreements, "fp32MaxAbsoluteError": max_error,
            "quantizedChangedPredictions": changed,
        }
        write_json(report_path, results)
        print(json.dumps({"suite": suite, "results": {name: {k: v for k, v in result.items()
                                                               if k not in ["observations", "mistakes"]}
                                                      for name, result in summary.items()},
                          "nativeDisagreements": len(native_disagreements), "q8Changes": len(changed)}), flush=True)
    assets = [{"path": p.name, "bytes": p.stat().st_size, "sha256": digest(p)}
              for p in sorted(bundle.iterdir()) if p.is_file()]
    write_json(args.output / "assets.json", {"files": assets, "totalBytes": sum(p["bytes"] for p in assets)})


if __name__ == "__main__":
    main()
