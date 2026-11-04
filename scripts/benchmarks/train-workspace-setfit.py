"""Train a research-only SetFit router using only the shared prompt examples."""

import argparse
import hashlib
import json
import os
import time
from importlib.metadata import version
from pathlib import Path

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", USE_TF="0")

import torch
from datasets import Dataset
from setfit import SetFitModel, Trainer, TrainingArguments
from transformers import set_seed

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--directory", required=True, help="Local pinned MiniLM snapshot")
parser.add_argument("--output", required=True, help="New research checkpoint directory")
parser.add_argument("--revision", required=True, help="Base model revision")
args = parser.parse_args()
output = Path(args.output).resolve()
if output.exists():
    parser.error("Use a new output directory; never overwrite an existing training run")
corpus_path = Path(__file__).parent / "workspace-routing-cases.json"
corpus = json.loads(corpus_path.read_text())
examples = corpus["promptExamples"]
train_inputs = {text.casefold() for text, _ in examples}
assert len(train_inputs) == len(examples)
assert all(text.casefold() not in train_inputs for text, _ in corpus["evaluation"])
modes = ["browser", "terminal", "thread"]
torch.set_num_threads(4)
torch.set_num_interop_threads(1)
set_seed(42)
started = time.perf_counter()
model = SetFitModel.from_pretrained(
    str(Path(args.directory).resolve()), device="cpu", local_files_only=True, labels=modes,
    head_params={"random_state": 42},
)
train_args = TrainingArguments(
    output_dir=str(output / "training-checkpoints"),
    batch_size=16, num_epochs=1, num_iterations=20, body_learning_rate=2e-5,
    seed=42, report_to="none", show_progress_bar=False, save_strategy="no",
)
trainer = Trainer(
    model=model, args=train_args,
    train_dataset=Dataset.from_dict({
        "text": [text for text, _ in examples],
        "label": [modes.index(mode) for _, mode in examples],
    }),
)
trainer.train()
model.save_pretrained(str(output))
metadata = {
    "baseRepository": "sentence-transformers/all-MiniLM-L6-v2",
    "baseRevision": args.revision,
    "corpusSha256": hashlib.sha256(corpus_path.read_bytes()).hexdigest(),
    "examples": [{"input": text, "destination": mode} for text, mode in examples],
    "hyperparameters": {
        "seed": 42, "batchSize": 16, "bodyEpochs": 1, "numIterations": 20,
        "bodyLearningRate": 2e-5, "head": "logistic regression, random_state=42",
    },
    "trainingMs": (time.perf_counter() - started) * 1000,
    "versions": {name: version(name) for name in [
        "torch", "transformers", "sentence-transformers", "setfit", "scikit-learn", "datasets",
    ]},
    "evaluationUsage": "No evaluation examples or labels used for training or checkpoint selection.",
}
(output / "routing-training.json").write_text(json.dumps(metadata, indent=2) + "\n")
print(json.dumps(metadata, indent=2))
