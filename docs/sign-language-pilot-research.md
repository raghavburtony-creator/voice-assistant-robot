# Sign-language pilot: Q-09 research and decision readiness

**Status: archived on 2026-11-27. E4 is retired and Q-09 is dropped; this research remains historical evidence only, not an active request for consultation or model selection.**  
**Historical issue:** [#91 — Q-09](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/91)  
**Scope:** Publicly documented MSL resources, dataset suitability questions, and a community-led path to a bounded pilot. This document does not select a language, approve data use, or claim endorsement.

## Findings

### 1. Language choice remains a community decision

Mauritian Sign Language (MSL) has identifiable local resources and research history. That makes it a concrete candidate to discuss with local Deaf/signing partners, but the project's location is not evidence that MSL is the right first language or that local partners want this product. Q-09 must remain open until the intended users and community partners confirm the choice.

Potential consultation partners identified in public sources include the Society for the Welfare of the Deaf (SWD) and the Mauritius Deaf Association. Their names appear in MSL resource acknowledgements and local project descriptions. This is a starting point for consultation, not evidence that either organisation has agreed to participate.

### 2. Public resources are not automatically ML training datasets

| Resource | What public documentation establishes | What remains unverified for Otto |
|---|---|---|
| [Official MSL online dictionary](https://swdmauritius.signsdiscovery.com/) | A public online dictionary exists. Public descriptions report individual word entries with video demonstrations. | Content licence, permission for downloading/reuse, permission for ML training or inference, signer releases, coverage of connected signing, metadata, and signer-independent splits. Treat as a learning/reference resource only unless rights holders grant explicit permission. |
| [Mauritian Sign Language corpus (Sallandre & Gebert, 2006)](https://cocoon.huma-num.fr/exist/crdo/search2.xql?keyword=LSM) | Research sources describe a corpus of eight Deaf adults, narrative and prescriptive genres, approximately 40 minutes, collected in Beau-Bassin. | Current access conditions, downloadable media, consent scope, permitted derivative/ML use, annotation format, participant demographics, and whether it can support the proposed task. |
| [INJS project history](https://www.injs-paris.fr/page/expertises-et-projets/cooperations-internationales/projet-de-developpement-de-la-langue-des-signes-mauricienne/) | Describes community corpus collection and validation by Deaf signers during the MSL dictionary project; the methodology evolved toward contextual video from local signers. | Whether any underlying recordings are available, who controls them, whether consent permits this project's use, and whether current community partners endorse reuse. |
| [SIGN-HUB MSL profile](https://thesignhub.eu/sign-language/234) | Documents MSL phonology/lexicon and acknowledges the Deaf community and local organisations. | Whether any linked material is licensed or technically suitable for training or evaluation. |
| [Mauritian Sign Language research overview](https://www.sfl.cnrs.fr/en/deaf-and-sign-languages) | Records the 2006 corpus description and links to the corpus discovery page. | Same access, rights, coverage and annotation questions as above. |

**Assessment:** Public evidence confirms that MSL dictionaries and research corpora exist. It does not establish that Otto has a legally and ethically usable, sufficiently representative continuous-video dataset. No candidate should be marked “approved for training” until the rights holder and community have confirmed the exact permitted uses in writing.

### 3. Recommended pilot shape to put to the community

Do not preselect continuous translation. Ask Deaf/signing partners which problem is useful and feasible. A bounded, visitor-started task is the safer first proposal to evaluate—for example, recognising a small, community-selected set of intents for a specific Otto workflow, with the system showing a text interpretation for confirmation. This is only a discussion proposal, not a decision.

Explicit non-goals for any initial pilot unless separately validated:
- General-purpose sign-language translation or fluent conversation.
- Treating isolated dictionary entries as sentence-level training examples.
- Treating ASL, BSL, or another sign language as a substitute for MSL.
- Inferring signer intent when confidence is low; uncertain or unrecognised input must remain correctable.
- Collecting or reusing recordings before the community governance and consent plan is agreed.

### 4. Questions that must be answered with community partners

1. Which language or variety should be supported first, and who are the intended users?
2. Which real task would provide value, and what should Otto explicitly not claim to understand?
3. Which Deaf-led organisations, signers, educators and researchers should govern vocabulary, grammar, regional variation and validation?
4. Who controls each candidate resource, and what exact permissions exist for viewing, storage, annotation, model training, inference, retention and publication?
5. If new recordings are needed, who owns and governs them; how will informed consent, withdrawal, compensation, safeguarding, access control and deletion work?
6. What signer diversity and recording conditions are necessary for a credible evaluation?
7. Who approves labels, disputed examples, failure categories and release criteria?

### 5. Evaluation requirements before model selection

- Split train/validation/test by signer, not by randomly splitting clips from the same signer.
- Reserve held-out signers and keep the test set inaccessible to model tuning.
- Include representative signing variation, camera positions, lighting, backgrounds and signing speeds agreed with participants.
- Report per-class precision/recall, confusion patterns, unrecognised/abstained rate and performance by relevant signer/context groups; do not report only aggregate accuracy.
- Have Deaf/signing reviewers validate annotations and adjudicate disagreements.
- Define a correction path in the product and measure whether users can detect and correct incorrect interpretations.
- Set minimum acceptance thresholds with community partners before collecting the test set or selecting a model.

## Proposed next steps

1. Invite a scoping conversation with the Society for the Welfare of the Deaf and Mauritius Deaf Association, alongside relevant MSL researchers and Deaf signers selected by those communities.
2. Present the questions in section 4 without presuming the language or pilot.
3. Ask each resource owner for written terms covering the exact intended uses; record resource-level decisions and evidence.
4. Co-design the pilot task, consent/governance plan and signer-independent evaluation.
5. Only then record a decision in `docs/decisions.md` and define the live recognition implementation slice.

A concrete, language-agnostic pilot for the community to react to is in [sign-language-pilot-proposal.md](sign-language-pilot-proposal.md).

## Current disposition

Q-09 is **not answered** by this desk research. The issue's completion criteria requiring community confirmation, dataset-rights assessment and an agreed validation plan remain unmet. Model/provider selection and live recognition integration remain blocked. This is an evidence-based deferral, not a rejection of MSL or a decision to use another language.

## Sources

- [Official Mauritian Sign Language online dictionary](https://swdmauritius.signsdiscovery.com/)
- [INJS — MSL development project](https://www.injs-paris.fr/page/expertises-et-projets/cooperations-internationales/projet-de-developpement-de-la-langue-des-signes-mauricienne/)
- [SIGN-HUB — Mauritian Sign Language](https://thesignhub.eu/sign-language/234)
- [CNRS Structures Formelles du Langage — Deaf and Sign Languages](https://www.sfl.cnrs.fr/en/deaf-and-sign-languages)
- [Sallandre & Gebert (2006) corpus discovery record](https://cocoon.huma-num.fr/exist/crdo/search2.xql?keyword=LSM)
