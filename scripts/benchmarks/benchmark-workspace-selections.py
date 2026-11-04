"""Measure exported classifier proposals without importing training libraries.

Uses isolated research dependencies: numpy, onnxruntime and tokenizers. Inputs
are classified only; this script never executes commands or navigates addresses.
"""

import argparse
import json
import math
import platform
import resource
import statistics
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads((args.directory / "routing.json").read_text())
    corpus = json.loads(args.cases.read_text())
    tokenizer = Tokenizer.from_file(str(args.directory / "tokenizer.json"))
    settings = ort.SessionOptions()
    settings.intra_op_num_threads = 4
    settings.inter_op_num_threads = 1
    session = ort.InferenceSession(str(args.directory / "model.onnx"), sess_options=settings,
                                   providers=["CPUExecutionProvider"])
    route_choices = [dict(id=key, label=label)
                     for key, label in zip(config["labels"], config["labelDescriptions"])]

    def choose(task, text, choices):
        assert 2 <= len(choices) <= config["maxOptions"]
        prefix = "".join("<<LABEL>>" + c["label"] for c in choices) + "<<SEP>>"
        ids = tokenizer.encode(prefix + config["tasks"][task]["instruction"] + text).ids
        assert len(ids) <= config["maxLength"]
        x = np.asarray([ids], dtype=np.int64)
        logits = session.run(["logits"], {"input_ids": x, "attention_mask": np.ones_like(x)})[0][0]
        assert logits.shape == (config["maxOptions"],) and np.isfinite(logits).all()
        return choices[int(logits[:len(choices)].argmax())]["id"]

    def propose(text):
        mode = choose("destination", text, route_choices)
        fields = {"browser": ["runtime", "profile"], "terminal": ["runtime", "project"],
                  "thread": ["runtime", "model", "project"]}[mode]
        return dict(destination=mode, **{key: choose(key, text, corpus["catalogs"][key]) for key in fields})

    for i in range(10):
        propose(corpus["cases"][i % len(corpus["cases"])]["text"])
    rows = []
    for case in corpus["cases"]:
        started = time.perf_counter()
        actual = propose(case["text"])
        rows.append(dict(text=case["text"], expected=case["expected"], actual=actual,
                         correct=actual == case["expected"], ms=(time.perf_counter() - started) * 1000))
    times = sorted(r["ms"] for r in rows)
    result = dict(platform=platform.platform(), onnxruntime=ort.__version__, cpuThreads=4,
                  correct=sum(r["correct"] for r in rows), total=len(rows),
                  medianMs=statistics.median(times), p95Ms=times[math.ceil(len(times) * .95) - 1],
                  peakRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss *
                  (1 if platform.system() == "Darwin" else 1024),
                  notes="10 full-proposal warmups; 3-4 sequential classifiers per proposal; no torch import.",
                  observations=rows)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "observations"}))


if __name__ == "__main__":
    main()
