# Personal BSL isolated-sign research workspace

This is a local, offline research project for the personal BSL prototype in issue #123. It is deliberately separate from the production web kit and its SignRecognizer adapter. Q-09 remains open for community confirmation, dataset governance and release criteria; this workspace does not answer it.

## Safety and data handling

- The webcam opens only after the operator types the exact per-recording consent phrase shown by the collector.
- Frames are processed in memory by MediaPipe Holistic Landmarker. The collector never creates a video or image file and makes no network request.
- Only normalized landmark sequences and capture metadata are written under local-data/. The signer and session identifiers should be opaque labels, not a person's name.
- Rights and consent are required by the manifest validator. Third-party rows additionally require a source URL, licence, attribution and explicit confirmation of the original clip copyright. A dataset-level licence alone is not sufficient.
- Dataset files, landmarks, the MediaPipe task model, checkpoints and ONNX exports are ignored by Git.

The Oxford BSLDict page describes a CC BY 4.0 dataset licence while also noting that copyright remains with the original video owners. The workspace does not download BSLDict or any other third-party source. Confirm the current complete terms and rights for each intended clip before adding a third-party manifest row: https://www.robots.ox.ac.uk/~vgg/research/bsldict/

## Setup

Use Python 3.11 or 3.12. Install the optional capture, training and test dependencies into a dedicated environment:

    cd ml/bsl
    python -m venv .venv
    .venv\Scripts\activate
    python -m pip install --upgrade pip
    pip install -e ".[capture,train,test]"

On macOS/Linux, activate the environment with source .venv/bin/activate.

Download the MediaPipe Holistic Landmarker task model manually from the official MediaPipe documentation and place it at assets/holistic_landmarker.task. The application does not fetch model assets on its own. Official Python usage and output contract: https://developers.google.com/edge/mediapipe/solutions/vision/holistic_landmarker

## Record one isolated sign

Choose a short label slug, a pseudonymous signer id and a new session id for each separate capture session:

    otto-bsl-collect --label hello --signer-id signer-01 --session-id session-2026-11-26-a --model-asset assets/holistic_landmarker.task --data-root local-data

The collector displays a notice and opens the camera only after the exact consent phrase is entered. Press Space to finish early or Q/Esc to cancel. Cancelled or unusable clips are not added to the manifest. Repeat each label across independent sessions; a model cannot be meaningfully evaluated from a single capture session.

The feature schema selects 14 upper-body pose points, all 21 points on each hand, and 22 selected face points around the brows, eyes, nose, lips and chin. Coordinates are converted to pixel space, centered on the shoulder or hip anchor and normalized by body scale. Fixed-length training features include normalized-time xyz deltas. The feature schema version is stored with every sample.

## Validate, train and export

The training command first validates every JSONL manifest row and its local NPZ file. It refuses unconfirmed rights, missing metadata, unsafe paths, wrong feature versions and malformed arrays.

    otto-bsl-train --data-root local-data --output-dir artifacts --epochs 30
    otto-bsl-export --checkpoint artifacts/bsl_temporal_candidate.pt --output artifacts/bsl_temporal_candidate.onnx

The split is never random by clip. With more than one signer, the workspace groups all clips by signer and reserves independent signers for train, validation and test. With one signer, it groups by capture session and labels the report "session-held-out personal evaluation". At least three independent signers or sessions are required; with fewer, the workspace refuses to produce a misleading evaluation. The training report includes accuracy, macro precision/recall/F1, per-label support and a confusion matrix. There are no performance thresholds or claims baked into the tool.

Training requires at least two sign labels in the training partition. Collect enough independent sessions (or signers) and examples for every class before expecting a usable model. Include a deliberate unknown/non-target label only when that category has been consistently annotated. A tiny personal dataset is a prototype, not evidence of general BSL understanding.

## Layout

- src/otto_bsl/features.py: selected landmarks, spatial normalization and fixed-length temporal features.
- src/otto_bsl/manifest.py: rights, consent, metadata, path and NPZ validation.
- src/otto_bsl/capture.py: consent-gated local webcam collection.
- src/otto_bsl/splits.py: signer-held-out or single-signer session-held-out splits.
- src/otto_bsl/model.py and training.py: temporal Conv-Transformer candidate and evaluation.
- src/otto_bsl/export.py: versioned ONNX export.
- tests/: deterministic schema, features, split, model, training and export coverage.

No exported model is integrated into Otto. A later browser/runtime slice would require its own accuracy, signer diversity, device, licence, accessibility and community validation gates.
