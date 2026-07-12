# FAIV Predict usability-evaluation protocol

## Purpose and research questions

This protocol evaluates whether representative users can operate and correctly
interpret the thesis prototype's core Predict feature. It is a small,
descriptive bachelor-thesis usability study, not a population-level clinical or
commercial experiment.

The study asks:

1. Can users complete prediction tasks with and without a posting time?
2. Can users distinguish a relative tier and raw model score from a guaranteed
   outcome or calibrated probability?
3. Can users recognize a provisional or stale result and recalculate it after
   changing an input?
4. Which interface terms, states, or interactions cause errors or hesitation?

## Participants and ethical handling

Target 8–12 representative participants where feasible. Five participants may
be used for a formative pilot, but results must then be described as descriptive
problem discovery rather than a statistically generalizable usability score.

Recommended participant mix:

- social-media/content practitioners or small-business administrators;
- students or prospective users familiar with Instagram planning;
- at least one participant with limited analytics or machine-learning
  familiarity, to test explanation clarity.

Include adults who use Instagram and can understand the test language. Exclude
the system developer and anyone who participated in designing the tested flow
from the primary participant results. Record relevant experience categories,
not unnecessary personal identifiers.

Before testing, obtain informed consent appropriate to the institution's thesis
requirements. Explain that the system and interface are being tested, not the
participant. Participation is voluntary and may stop at any time. Use participant
codes such as `P01`; do not place names, login passwords, tokens, private brand
captions, or identifiable account data in the repository.

## Fixed test environment

Record before the first session:

| Item | Recorded value |
| --- | --- |
| Application commit/version | _Pending_ |
| Test date range | _Pending_ |
| Browser and version | _Pending_ |
| Screen/device | _Pending_ |
| Model version(s) | _Pending_ |
| Test brand/data mode | _Pending_ |
| Facilitator | _Pending_ |

Use the same build, browser class, task wording, and prepared non-sensitive test
inputs for every participant. Reset the draft state between participants. Do
not retrain models during the sessions unless retraining itself is the task
being studied.

## Moderator script

Read the following before each session:

> We are evaluating FAIV Predict, not your ability. Please think aloud by saying
> what you expect, notice, and find confusing. I will not guide you unless you
> become blocked; any help I give will be recorded. The displayed result is a
> research-prototype output and must not be used as a business guarantee.

Do not teach participants the meanings of `raw score`, `provisional`, or
`stale` before the relevant interpretation task. That would invalidate the test
of whether the interface explains them.

## Standard task set

Prepare one permitted thesis test account and a caption that contains no
sensitive information. Start timing after reading each task and stop when the
participant states that it is complete.

| Task | Participant instruction | Objective success criterion |
| --- | --- | --- |
| U01 | Select the requested brand and create a prediction using a specified format, future date, posting hour, and caption. | A result is produced for the requested inputs without moderator intervention. |
| U02 | Explain what the predicted tier and model score mean, and name one limitation. | Participant states that the tier is relative, does not call the score a guaranteed/calibrated probability, and identifies a supported limitation. |
| U03 | Create another prediction without choosing a posting time, then explain its status. | Submission succeeds and participant recognizes that the result is provisional because time is unknown. |
| U04 | Change the caption or format after a prediction and decide what must happen next. | Participant recognizes the prior result as stale and recalculates rather than treating it as current. |
| U05 | Find the model/version or validation evidence used by the result. | Participant locates the displayed provenance/evaluation information. |
| U06 | Respond to a prepared safe failure state, such as a brand with no usable model or a temporarily unavailable service. | Participant recognizes an honest unavailable/error state and does not report a fabricated prediction. |

Do not intentionally delete data, expose credentials, change RLS, rotate tokens,
or modify persistent n8n configuration for U06. Use a reversible test state.

## Measurements

For every task record:

- completion: `1 = completed`, `0.5 = completed with moderator help`,
  `0 = not completed`;
- completion time in seconds;
- number of observable user errors;
- moderator assistance: encoded as completion `0.5` and explained in the
  observation notes;
- participant's post-task Single Ease Question (SEQ), 1 = very difficult and
  7 = very easy;
- notable think-aloud statements, paraphrased unless consent permits a short
  anonymous quote.

After all tasks, administer the standard ten-item System Usability Scale (SUS)
using its alternating positive/negative wording and a 1–5 response scale. Score
it as follows:

Use one institution-approved language version consistently. If an Indonesian
translation is used, cite the validated translation selected in the written
thesis and preserve its wording; do not translate or paraphrase items differently
for each participant. The response anchors are `1 = strongly disagree` through
`5 = strongly agree`.

| Item | Standard construct/item wording |
| ---: | --- |
| 1 | I think that I would like to use this system frequently. |
| 2 | I found the system unnecessarily complex. |
| 3 | I thought the system was easy to use. |
| 4 | I think that I would need the support of a technical person to use this system. |
| 5 | I found the various functions in this system were well integrated. |
| 6 | I thought there was too much inconsistency in this system. |
| 7 | I would imagine that most people would learn to use this system very quickly. |
| 8 | I found the system very cumbersome to use. |
| 9 | I felt very confident using the system. |
| 10 | I needed to learn a lot of things before I could get going with this system. |

```text
odd items contribution  = response - 1
even items contribution = 5 - response
SUS score               = sum(all contributions) × 2.5
```

SUS produces a 0–100 usability score, not a percentage of users and not an ML
accuracy measure. With a small thesis sample, report individual scores, median,
range, and sample size; do not claim population significance. Preserve the
completed anonymous response sheet as private raw evidence.

## Predeclared descriptive criteria

These criteria are pragmatic thesis targets, not universal scientific laws:

- at least 80% unassisted completion across U01, U03, and U04;
- no participant interprets a displayed score as a guaranteed outcome after
  completing U02;
- median SEQ of at least 5 for the core prediction task U01;
- no unresolved severity-1 usability issue before the final demonstration.

Failure to reach a target must be reported and discussed. Do not remove a
difficult participant, change task wording mid-study, or repeat only successful
sessions to improve the summary.

## Raw task-observation form

Create one copy of this table per participant.

Participant code: _Pending_  
Relevant experience category: _Pending_  
Session date/time: _Pending_  
Consent recorded: _Yes/No — pending_

| Task | Completion (0/0.5/1) | Time (s) | Errors | SEQ (1–7) | Observation / assistance / participant interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| U01 | — | — | — | — | _Pending_ |
| U02 | — | — | — | — | _Pending_ |
| U03 | — | — | — | — | _Pending_ |
| U04 | — | — | — | — | _Pending_ |
| U05 | — | — | — | — | _Pending_ |
| U06 | — | — | — | — | _Pending_ |

SUS responses/items 1–10: _Pending_  
Calculated SUS score: _Pending_  
Overall comments: _Pending_

## Results summary template

Complete this section only after all genuine sessions are finished.

| Measure | Result |
| --- | --- |
| Recruited / completed participants | _Pending_ |
| Participant experience distribution | _Pending_ |
| U01 unassisted completion | _Pending_ |
| U03 unassisted completion | _Pending_ |
| U04 unassisted completion | _Pending_ |
| Median U01 completion time | _Pending_ |
| Median U01 SEQ | _Pending_ |
| Participants correctly interpreting raw score | _Pending_ |
| Participants correctly interpreting provisional status | _Pending_ |
| SUS median and range | _Pending_ |
| Moderator interventions | _Pending_ |
| Sessions excluded, with predeclared reason | _None / pending_ |

## Evidence-generation command

After collecting genuine, anonymized responses, copy the committed schema-only
template and enter one participant per row:

```powershell
Copy-Item .\docs\usability_responses.template.csv .\docs\usability_responses.csv
```

Keep the participant CSV private. Validate it and generate the descriptive
appendix without manually recomputing SUS or task summaries:

```powershell
python .\scripts\analyze_usability.py .\docs\usability_responses.csv `
  --minimum-participants 5 `
  --output .\docs\FINAL_USABILITY_EVIDENCE.md
```

Use the actual planned sample size in `--minimum-participants`; the default of
five represents only the minimum formative pilot described above. The script
rejects missing/invalid task values and an empty participant file rather than
inventing results. Review the generated report against the handwritten/session
notes and issue log before citing it.

## Usability issue log

Severity definitions:

- `1 — Critical`: prevents a core task, risks destructive action, or causes a
  materially false interpretation of the prediction;
- `2 — High`: causes task failure or repeated misunderstanding but has a
  workaround;
- `3 — Medium`: causes delay, hesitation, or recoverable error;
- `4 — Low`: cosmetic or preference issue with little task impact.

| Issue ID | Task/participant codes | Observation | Severity | Proposed change | Resolution/version | Retest evidence |
| --- | --- | --- | ---: | --- | --- | --- |
| _No issues recorded yet_ | — | — | — | — | — | — |

## Final reporting checklist

- Report participant count, recruitment method, experience mix, task script,
  build/model versions, and study dates.
- Report task failures and moderator assistance, not only successful averages.
- Separate observed behavior from participant opinion.
- Explain that the sample supports formative/descriptive usability conclusions,
  not population-wide inference.
- Link each implemented UX revision to an issue ID and retest observation.
- Store anonymized raw forms, consent records, and screenshots in the private
  thesis evidence archive; publish only appropriately redacted summaries.
- Never fabricate participants, quotes, times, SUS responses, or results.

## Method references for the thesis

- Brooke, J. (1996). SUS: A “quick and dirty” usability scale. In P. W.
  Jordan, B. Thomas, B. A. Weerdmeester, and I. L. McClelland (Eds.),
  *Usability Evaluation in Industry*. Taylor & Francis.
- Sauro, J., and Dumas, J. S. (2009). Comparison of three one-question
  post-task usability questionnaires. *Proceedings of CHI 2009*.

Use the citation style required by the study program and verify bibliographic
details against the copy actually cited in the final thesis.
