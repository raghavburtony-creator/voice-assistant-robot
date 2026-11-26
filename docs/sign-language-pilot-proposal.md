# Sign-language pilot: a language-agnostic proposal for the community to react to

**Status: proposal only. Q-09 stays open.**
**Issue:** [#91, Q-09](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/91). Background: [sign-language-pilot-research.md](sign-language-pilot-research.md).

This page gives Deaf and signing partners something concrete to accept, change or reject. It names no sign language, selects no model or provider, and approves no dataset. Every number marked *starting value* is a figure to negotiate. None is evidence-based. D-29's rules apply throughout: a sign reading is untrusted text, the visitor confirms it, and it never runs a tool or an action by itself.

## 1. What the pilot would be

A small, **closed set of intents** for one Otto workflow, recognised from isolated, visitor-started signing, with a text reading that the visitor confirms, corrects or discards before anything is sent.

It would not be general translation, fluent conversation, fingerspelling, or sentence-level understanding. The research doc already lists these as non-goals. A closed set is the part of the problem a small model can plausibly do, and it lets Otto say "I did not understand" instead of guessing.

## 2. Candidate intents, for the community to choose or replace

These are *meanings* Otto can already act on through its existing text path. They are not signs. The community decides which sign, or which variants, express each meaning, and may drop any of them.

| Intent (meaning) | What Otto does with the confirmed text |
|---|---|
| Yes | The model treats it as the visitor saying "yes" in the conversation. |
| No | The same, for "no". |
| Stop | Otto stops talking. |
| Repeat | Otto says it again. |
| Help | Otto says what he can do here. |
| Go back | The model asks for the previous page through its normal, checked tool. |
| Next | The model moves a running guided task on, through the existing task tools. |
| Show me where | The model asks which part of the page, as text. |

Starting value: 6 to 10 intents. Fewer, well-chosen intents are better than more.

Two cautions:
- **Yes and No are only conversation words.** A sign reading can never answer a native operating-system approval prompt for a desktop action (D-25), and it can never satisfy a policy confirmation. Those remain native, visitor-driven dialogs. A misread "yes" must not be able to approve anything.
- **Slots are out of scope.** "Show me *billing*" needs a vocabulary that grows with each app. The first pilot stays closed-set with no slots.

## 3. What the community decides before any model work

| Decision | Who decides |
|---|---|
| Which language or variety, and who the intended users are | Deaf-led partners |
| Which intents from section 2 stay, which change, which are added | Deaf-led partners |
| Which signs and regional variants express each intent | Deaf signers and educators |
| What Otto must never claim to understand | Deaf-led partners |
| Who owns, governs and can withdraw any recordings | The signers, with the partners |
| The acceptance thresholds in section 5 | Partners, **before** a test set is recorded |

## 4. Data, without presuming a source

No existing recording is assumed usable. A dictionary is a reference, not a training corpus, and the 2006 corpus described in the research doc has unknown access, consent scope and annotation. Three routes, to be chosen with the partners:

1. **New community-governed collection.** Signers record the agreed intents under a written consent plan covering ownership, withdrawal, compensation, safeguarding, access and deletion.
2. **Rights-holder permission for existing material,** in writing, for the exact uses: viewing, storage, annotation, training, inference, retention, publication.
3. **A community-run evaluation only.** Recordings are used to test a recognizer the community has judged acceptable, and never to train one.

Starting values for a collection, to negotiate:
- A signer-independent split: train, validation and test by signer, never by clip.
- Held-out signers kept away from all tuning.
- At least 3 camera positions and 3 lighting conditions.
- A **negative set** of non-intent signing, idle movement and unrelated gestures. A pilot with no negative set cannot measure the error that matters most.

## 5. How it would be judged

Measured per intent and per signer or context group. Aggregate accuracy alone is not reported.

| Measure | Why |
|---|---|
| **False-accept rate on the negative set** | How often non-intent signing is read as an intent. This is the most important measure because it is how Otto ends up saying something the visitor never signed. |
| Per-intent precision and recall, with a confusion table | Shows which intents get confused with each other. |
| **Abstain rate** | How often Otto says "not recognised" instead of guessing, and whether that is calibrated. |
| Correction success | Whether users notice a wrong reading and correct or discard it, using the panel as built. |
| Deaf-reviewer judgement | Reviewers validate labels, adjudicate disputes and rate how natural the interaction feels. |

Acceptance thresholds are set by the partners before the test set exists. This proposal sets none, because any number it suggested would look like a target.

## 6. What can already be built without a model

Slice [#115](https://github.com/raghavburtony-creator/voice-assistant-robot/pull/115) ships the adapter boundary: consent notice, persistent Stop, bounded buffer, gate-validated updates and confirm, correct or discard. Once the pilot is agreed, a recognizer plugs in behind it.

A host that captures camera frames is a separate slice, and so is the recognizer itself. The kit currently opens no camera.

## 7. Approach families, not a selection

Which family fits depends on the language, the data and the device budget, so none is selected here. Evidence on each should be gathered only after sections 3 and 4 are settled.

- **Local, landmark-based classification** of hand, face and body keypoints over a short window. It keeps raw video on the device and suits a small closed set. It depends on keypoint quality across skin tones, lighting and signers, which the evaluation must test.
- **Local video classifiers** trained on short clips. They need more data and compute.
- **Remote recognition services.** They need the notice, retention and subprocessor checks D-29 already requires.

## 8. What would close Q-09

Q-09 could close, and a decision be recorded in `docs/decisions.md`, once there is:
1. community confirmation of the language and intended users;
2. an agreed intent list and the community's chosen signs;
3. a written data route from section 4, with rights confirmed;
4. thresholds and an evaluation plan agreed before the test set;
5. a named group that approves labels and release.

Until then the kit ships the adapter boundary and no recognizer.
