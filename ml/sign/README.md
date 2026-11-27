# Otto BSL sign-recognition prototype

**Archived on 2026-11-27:** E4 has been retired from Otto's active roadmap and Q-09 is dropped. This workspace is retained as historical personal-prototype code only; no further dataset collection, training or production integration is planned. Do not treat its artifacts or measurements as a supported recognizer or community-validated BSL capability. Any revival requires a new project proposal and renewed data-consent/rights review.

This is an **offline, personal British Sign Language (BSL) training workspace**. It begins with isolated signs and uses explicit consented examples. It does not yet provide continuous sentence recognition or connect a live model to Otto's production sign adapter.

## Setup

Requirements: Python 3.11+, a webcam for collection, and a CPU or CUDA-capable PyTorch environment.

```bash
cd ml/sign
python3 -m venv .venv
. .venv/bin/activate                 # Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

The optional capture dependencies are OpenCV and MediaPipe. PyTorch is the training runtime. ONNX is used for export.

## Collect examples

Start with a small vocabulary you can label confidently. A label is a stable class ID; gloss is the human-readable label you want to see in reports.

```bash
otto-sign-record --label HELLO --gloss HELLO --signer-id owner --session-id day-01 --takes 15 --consent-confirmed
otto-sign-record --label THANK_YOU --gloss THANK_YOU --signer-id owner --session-id day-01 --takes 15 --consent-confirmed
```

In the camera window, press Space to begin a take and Space again to finish it. Press Q to quit. The collector shows the camera locally, extracts MediaPipe Holistic landmarks, checks framing, and stores compressed `.npz` landmark sequences plus an auditable `manifest.csv`. **It does not save raw video.** Each take records language, gloss, pseudonymous signer ID, session ID, source, consent basis and attribution.

Use a new session ID for each separate capture session. A personal one-signer evaluation requires at least three sessions; five or more is preferable. The split keeps whole sessions apart, not random clips. When at least three signers are present, the split holds out signers.

## Train and export

```bash
otto-sign-train --manifest data/manifest.csv --data-root data --output runs/bsl-personal
```

The tests run separately (`pip install -e ".[test,export]"`, then `pytest -q`).

The pipeline:

1. validates the BSL-only manifest, source/consent metadata and paths;
2. loads landmark sequences without unpickling Python objects;
3. normalizes both hands, upper-body pose and selected face/non-manual landmarks by shoulder framing;
4. adds hand-shape and temporal-velocity features and resamples to 64 frames;
5. trains a compact temporal convolution + Transformer classifier with validation-based early stopping;
6. reports top-1, top-3 and per-class recall, then writes `best.pt`, `bsl-sign-v1.onnx`, `model.json` and `metrics.json`.

All data and generated artifacts under `data/` and `runs/` are ignored by Git.

## Evaluation rules

- Three or more signer IDs: groups are split by signer and labelled `signer-independent`.
- Fewer than three signers: groups are split by signer/session and labelled `personal-session-held-out` for one signer or `multi-signer-session-held-out` otherwise.
- The pipeline never falls back to a random clip split.
- All classes must appear in the training split. Validation/test sessions do not need to contain every sign; unsupported per-class metrics are reported with no support instead of leaking clips between splits.
- A one-signer session-held-out score measures repeatability across that person's sessions only. It says nothing about generalization to other BSL signers.

The initial model is an experimental candidate. No accuracy figure is claimed until the user has collected examples and trained it. Keep a held-out test set untouched while changing the model or confidence thresholds.

## Data rights and privacy

The collector defaults to owner-recorded examples with an explicit signer-consent flag. Landmark arrays include face and body shape information and should be treated as sensitive biometric data: keep them local, do not upload them by default, and delete the local `data/` directory when no longer needed. Do not record another person without informed consent. Do not commit the manifest, feature arrays, source videos, checkpoints or exported models.

Third-party data is not fetched automatically. A manifest row with a non-self-recorded source must carry a rights basis and attribution, but these fields are metadata, not legal verification. Check each source and video before use. [Oxford BSLDict](https://www.robots.ox.ac.uk/~vgg/research/bsldict/) describes its dataset as CC BY 4.0 but says original videos remain copyrighted by their original owners; UCL BSL SignBank restricts scraping and bulk downloads without permission; BOBSL has access restrictions. Do not assume a dataset-level licence clears every video.

## Architecture boundary

This workspace is deliberately separate from `web/src/otto/sign/`. The next integration work must:
- port the exact feature schema into TypeScript and add shared Python/TypeScript parity fixtures;
- run MediaPipe and ONNX in a browser worker under the existing visitor-started sign consent lifecycle;
- validate the model's BSL performance and calibrate abstention on held-out data;
- inject a real `SignRecognizer` only after the model, capture rate, browser runtime and provider disclosures are verified.

The D-21 still-image camera feed is not reused. No new server endpoint, conversation channel, event bus or action authority is introduced by this training workspace.
