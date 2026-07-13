# FAIV Predict user evaluation protocol

Status: protocol ready; recruitment, sessions, analysis, and thesis reporting are pending real participants. No participant result is represented in this document.

## Study purpose and boundary

This formative usability study evaluates whether target users can complete the prediction workflow, interpret the relative performance tier and model-supported alternatives, and make a concrete content-planning decision. It does not validate future engagement, establish causal uplift, or replace the model evaluation.

Target sample: 3-5 social media specialists, content creators, or small-brand staff who have planned Instagram content within the previous six months. This is an appropriately bounded formative study for a bachelor-thesis prototype; it is not a population-representative survey.

## Pre-registration record

Complete and freeze this table before the first session.

| Field | Value |
| --- | --- |
| Study ID | `FAIV-UX-01` |
| Protocol version / commit | **Pending** |
| Frozen application URL/build | **Pending** |
| Session dates | **Pending** |
| Facilitator | **Pending** |
| Planned sample | 3-5 participants |
| Recruitment channel | **Pending** |
| Ethics/departmental approval or exemption | **Pending - confirm with supervisor/institution** |
| Analysis freeze date | **Pending** |

Do not start recruitment until the supervisor confirms the applicable consent, recording, and ethics requirements.

## Eligibility and recruitment

Include participants who:

- are at least 18 years old;
- have planned, reviewed, or created Instagram content in the last six months;
- can read the interface language used in the study; and
- are not members of the development team.

Record role and broad experience band only (`<1 year`, `1-3 years`, `>3 years`). Do not collect Instagram credentials, account tokens, client names, private campaign material, or special-category personal data. Assign participant IDs `P01`-`P05`; keep consent records separate from task notes.

## Session setup

- Duration: approximately 25-35 minutes.
- Mode: moderated in person or screen share.
- Data: a supervisor-approved demonstration account with non-sensitive content.
- Recording: off by default; enable only with explicit consent and institutional approval.
- Facilitator stance: ask participants to think aloud, but do not explain a term until the participant has attempted the task.
- Failure handling: if live Instagram access fails, use the prepared stored-history fallback and record that the fallback was used.

Before each session, reset the demo workspace to the same state and record the application commit, model version, served scope, and whether the model is `validated` or `exploratory`.

## Participant introduction and consent check

Use this neutral script:

> We are evaluating the FAIV Predict interface, not you. The system estimates a relative Low, Average, or High tier from historical metadata. It does not guarantee engagement. Please work as you normally would and describe what you think the information means. You may stop at any time.

Confirm consent, voluntary participation, recording choice, and permission to quote anonymized comments before continuing.

## Task script

| Task | Participant instruction | Completion evidence | Facilitator must not reveal |
| --- | --- | --- | --- |
| 1. Orient | Select the assigned brand and determine whether a prediction model is available. | Finds the correct brand and recognizes ready/caution/no-model state. | Meaning of the status labels before the participant interprets them. |
| 2. Create | Prepare one realistic post using the supplied brief, format, caption, date, and optional time; request a prediction. | A saved prediction result or an accurately explained blocked state. | Which tier to expect. |
| 3. Interpret | Explain the tier, the class-aware trust information, and whether the displayed score is a probability. | States that the tier is relative and scores are uncalibrated; identifies model scope/status. | The correct wording until after the answer is recorded. |
| 4. Act | Review the top model-supported alternatives and choose one concrete draft change, or deliberately keep the draft. Explain why. | Makes and justifies a decision without describing the alternative as guaranteed uplift. | Which change is preferred. |
| 5. Verify | Find the saved prediction in History and explain any predicted-versus-observed information that is available. | Locates the record and distinguishes prediction from verified mature outcome/unavailable state. | Whether the model was “right.” |
| 6. Recover | Locate guidance for no model, stale evidence, or unavailable Instagram data. | Finds Model Health/Brands guidance or stored-data fallback. | Navigation destination unless the participant is blocked for two minutes. |

For each task record: success (`independent`, `with prompt`, `not completed`), elapsed time, navigation errors, terms that caused hesitation, facilitator prompts, and one concise observation.

## Comprehension questions

Ask before correcting the participant. Score each `1` correct or `0` incorrect/unclear.

1. Does a High model score mean the post has a calibrated probability of high engagement? Explain.
2. What is the difference between a prediction tier and a verified mature outcome?
3. Do user-provided trend notes change the Random Forest tier? Where may they have an effect?
4. What does an `exploratory` model status allow you to conclude?

Minimum interpretation target for this formative study: at least 3 of 4 correct per participant. Report every item separately; do not hide a recurrent misconception behind the total.

## SUS administration and scoring

After the tasks, administer the canonical ten-item System Usability Scale (SUS) in its standard order and five-point response scale. Use an institution-approved copy of the instrument and cite the original SUS source in the thesis; do not rewrite items between participants.

Score as follows:

- odd-numbered items: response minus 1;
- even-numbered items: 5 minus response;
- sum the ten contributions and multiply by 2.5;
- valid range: 0-100; this is a usability score, not a percentage.

With only 3-5 participants, report every anonymized SUS score, median, range, and mean to one decimal place. Do not claim population-level usability or statistical significance. A single aggregate without the sample size is not acceptable.

## Qualitative questions

1. Which information most influenced your content decision?
2. Which term or number was hardest to understand?
3. What, if anything, made you trust or distrust the result?
4. What is the one change that would make this workflow more useful in your work?

## Data-capture template

Create one local, access-controlled CSV with these columns; do not commit participant-level data:

```text
participant_id,role_band,experience_band,session_date,build_commit,model_version,model_status,fallback_used,t1_outcome,t1_seconds,t2_outcome,t2_seconds,t3_outcome,t3_seconds,t4_outcome,t4_seconds,t5_outcome,t5_seconds,t6_outcome,t6_seconds,cq1,cq2,cq3,cq4,sus_score,critical_incidents,facilitator_prompts,anonymized_notes
```

Store signed consent separately. Remove screen names, organization names, account identifiers, and quoted client material from the analysis dataset.

## Analysis plan

1. Verify completeness and record exclusions with reasons.
2. Report task outcomes as counts over the actual sample, never as unsupported population percentages.
3. Report time descriptively using median and range; do not infer speed improvement without a comparator.
4. Report comprehension by item and participant.
5. Calculate SUS exactly once from raw item responses and independently verify the formula.
6. Code qualitative notes into a small audit table: issue, supporting participant IDs, severity, affected screen, and proposed action.
7. Distinguish a one-person preference from a repeated usability issue.
8. Preserve negative findings; they are evidence, not failed results.

Suggested severity rule:

| Severity | Rule |
| --- | --- |
| Critical | Prevents task completion or produces a materially incorrect interpretation. |
| Major | Causes repeated hesitation, facilitator intervention, or a wrong decision that the user later corrects. |
| Minor | Slows the task or affects wording/comfort without changing the decision. |

## Thesis reporting template

Complete only after real sessions.

> **Participants.** [n] participants completed the study: [role/experience summary]. Recruitment and consent followed [approved process].
>
> **Task performance.** [counts and median/range], with [fallback count] sessions using stored data. The most frequent difficulty was [finding], observed in [participant IDs].
>
> **Comprehension.** [item-level results]. The result supports/does not support the claim that users understood [bounded claim].
>
> **SUS.** Scores were [anonymized list], with median [x], range [x-y], and mean [x]. Given n=[n], these values are descriptive only.
>
> **Design implications.** [changes made or consciously deferred], linked to the issue audit table.

## Completion evidence

T6.1 is complete only when all boxes are supported by dated artifacts:

- [ ] supervisor/ethics requirement confirmed;
- [ ] protocol and build frozen before the first participant;
- [ ] 3-5 eligible participants completed sessions;
- [ ] consent and participant data stored separately and securely;
- [ ] SUS calculations independently checked;
- [ ] comprehension and qualitative findings reported, including failures;
- [ ] thesis evaluation section updated; and
- [ ] no participant-level or identifying data committed to Git.
