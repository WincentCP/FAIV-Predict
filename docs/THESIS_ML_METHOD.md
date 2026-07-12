# Bachelor-thesis machine-learning method

## Research artifact

FAIV Predict classifies a planned Instagram post into `LOW`, `AVERAGE`, or `HIGH` historical engagement-performance tiers. It is a decision-support classifier, not a causal estimator of reach, sales, or guaranteed uplift.

The scientifically defensible claim is deliberately narrow: the model estimates
a **relative cumulative likes-and-comments engagement tier** from publication
metadata and structural caption features represented in verified historical
Instagram data. It does not inspect the actual image, video, audio, visual
quality, semantic meaning, paid-media exposure, reach, saves, shares, conversion,
or revenue. Consequently, the artifact must not be described as understanding
content quality or predicting virality.

## Population and eligible observations

Training uses only records that satisfy all of the following:

- source is `instagram_graph`;
- immutable `instagram_media_id` exists;
- engagement rate, posting hour, and timestamp are present;
- the post is at least seven complete days old, so an obviously immature
  cumulative engagement label is never used;
- the record belongs to the selected account or confirmed niche cohort;
- the follower denominator captured at first observation is preserved during
  later syncs.

Legacy, manually invented, caption-matched, ownerless, or unverified records are excluded. Account models require at least 200 eligible posts; pooled niche models require at least 30.

## Outcome definition

For a synchronized post:

```text
engagement rate (%) = (likes + comments) / follower_count_at_post × 100
```

Despite its historical database name, `follower_count_at_post` is not guaranteed
to be the follower count at publication. For a post first observed near
publication it approximates the audience at posting; for an older post imported
during the initial synchronization it is the follower count at first
observation. The denominator must therefore be reported as a **first-observation
follower proxy**, not as an exact historical follower count.

Likewise, the numerator is the cumulative likes and comments available at the
latest synchronization after the post passes a seven-complete-day maturity
gate. It is not an engagement snapshot taken at exactly seven days. Older posts
may have had more time to accumulate interaction than newer eligible posts. The
implemented outcome is therefore:

```text
relative cumulative engagement index (%)
  = cumulative (likes + comments) at latest sync
    / follower count at first observation
    × 100
```

This definition is acceptable for a retrospective bachelor-thesis prototype if
the population boundary and bias are disclosed. It does not support claims
about exact seven-day engagement, final lifetime engagement, reach, sales, or
causal uplift. A stronger future study should prospectively capture followers
near publication and immutable metric snapshots at a fixed horizon such as
seven days.

The chronological training portion supplies the 33rd and 67th percentile thresholds:

- `LOW`: ER below P33;
- `AVERAGE`: ER from P33 through P67;
- `HIGH`: ER above P67.

Thresholds are never calculated from the held-out test period. This prevents test-label leakage.
Training is rejected unless `LOW`, `AVERAGE`, and `HIGH` are all represented in
the training split; a binary artifact is never presented as a three-tier model.

## Predictors

The version-2 feature contract contains:

1. single-image flag;
2. carousel flag;
3. Reels flag;
4. local posting hour;
5. caption character length;
6. hashtag count;
7. CTA-keyword flag;
8. weekend flag in Asia/Jakarta;
9. question-mark flag;
10. emoji count.

The Instagram synchronization path, training path, and inference path use the same Python `DataPreprocessor`. A golden automated test verifies that one representative post produces an identical ordered feature vector through training and inference.

Visual Concept is not an ML feature. Gemini analysis may help rewrite a caption, but only the resulting caption and supported metadata affect a new prediction.

## Validation design

Rows are ordered by immutable timestamp and media ID, then split chronologically:

- oldest 80%: training;
- newest 20%: held-out test.

The fixed Random Forest configuration is:

```text
n_estimators = 100
max_depth = 4
min_samples_leaf = 5
random_state = 42
```

Every candidate is compared with:

1. `DummyClassifier(strategy="most_frequent")`, which represents a no-skill
   majority-class baseline; and
2. multinomial Logistic Regression, which represents a simpler learned linear
   comparator.

Random Forest is justified as the selected algorithm only when its temporal
evidence is interpreted against both comparators. Merely reporting one accuracy
number is insufficient.

Within the initial oldest 80%, expanding-window temporal folds provide a
stability check without exposing the newest 20% final holdout during model
development. Each fold trains on earlier observations and validates on the next
chronological block. These folds describe variation across temporal cutoffs;
the newest 20% remains the final test and must not be reused for hyperparameter
selection. If the available history cannot form valid folds containing the
required classes, the limitation is recorded rather than replaced with random
cross-validation.

The operational and scientific decisions are intentionally separate:

- `promotion_gate` protects runtime continuity. A candidate replaces the active
  artifact only when its held-out accuracy is strictly higher than the
  majority-class baseline. A rejected candidate writes one of at most five
  local diagnostic artifacts per scope but is not uploaded or registered, so
  the previous working model remains active.
- `scientific_gate` determines whether the result may be presented as validated
  evidence. It requires operational promotion, complete held-out class
  coverage, no zero recall for an observed class, positive balanced-accuracy
  and macro-F1 gains over the majority baseline, at least two evaluated temporal
  folds, and positive gain on a majority of evaluated folds. Failure of any
  criterion produces `evaluation_status = exploratory`, even if the artifact
  remains operationally usable.

This separation prevents a software availability decision from being mistaken
for proof of scientific validity. Rejection diagnostics are not durable thesis
evidence and may disappear when the container is recreated.

## Reported evidence

The evaluation contract `faiv-thesis-v2` stores:

- accuracy gain over baseline;
- balanced accuracy;
- macro and weighted precision, recall, and F1;
- ordinal mean absolute error after mapping `LOW=0`, `AVERAGE=1`, and `HIGH=2`;
- quadratic weighted Cohen's kappa;
- per-class precision, recall, F1, and support;
- fixed-order confusion matrix;
- training and test class distributions;
- Dummy and Logistic Regression comparator results;
- expanding-window temporal-validation summaries;
- holdout permutation importance measured with balanced accuracy, alongside the
  production model's impurity-based feature importance;
- sample counts and data time window;
- P33/P67 values;
- operational promotion decision, scientific gate, evaluation status, and warnings;
- empirical training-hour counts;
- model parameters;
- dataset SHA-256;
- training/preprocessing source SHA-256;
- Python, NumPy, pandas, scikit-learn, and requirements-file versions/hashes.

Macro metrics prevent a large class from hiding failure on another class.
Balanced accuracy gives equal weight to class recall. Weighted metrics describe
aggregate performance under the observed held-out distribution. Ordinal mean
absolute error distinguishes an adjacent error from a two-tier `LOW`–`HIGH`
error; quadratic weighted kappa measures ordinal agreement while accounting for
chance agreement. Per-class support, recall, and the confusion matrix remain the
primary diagnostic evidence, especially for small test sets.

The interface's mean-decrease-in-impurity importance is a global model summary,
not a signed explanation of one prediction. Holdout permutation importance is
reported as a complementary feature-reliance check because it measures the
change in unseen-period performance when one feature is shuffled. Neither
method establishes causality.

No universal score such as 70% accuracy is treated as automatic proof of
validity. The final thesis must interpret test size, class support, baseline and
Logistic Regression comparisons, fold-to-fold stability, and error severity
together. A `validated` status means the implemented scientific gate passed; it
does not establish external validity beyond the represented brands, niche,
language, season, and observation window.

## Reproducibility and privacy

The dataset fingerprint hashes immutable media identity, brand identity, timestamp, engagement rate, and derived feature vector in canonical order. Raw captions are excluded from exported evidence. The source fingerprint hashes `preprocessing.py` and `train_pipeline.py`; runtime evidence records core library versions and the production requirements hash. Together with parameters, thresholds, feature order, collision-resistant model version, and random seed, these values make the experiment state traceable without publishing tokens or captions. A hash proves identity, not availability: an exact independent rerun still requires a retained private data snapshot or unchanged source database.

## Optional posting time

When posting time is unknown, inference frequency-weights predictions over only
the hours actually observed in the model's training split. The result is
explicitly `provisional`. Legacy artifacts without empirical hour counts use
all 24 hours with a visible limitation. Once a time is selected, the user must
recalculate; the prior result remains immutable history.

## Interpretation limitations

- Random Forest class scores are not calibrated probabilities.
- Sensitivity scenarios are non-causal model simulations.
- Performance may not generalize beyond the represented accounts, niches, language patterns, season, or time window.
- Organic Instagram engagement can be affected by paid promotion, giveaways, algorithm changes, creative quality, audio, and external events not represented by the features.
- Cumulative engagement is gated to posts at least seven days old but is not a
  fixed-horizon label; older posts have had more time to accumulate engagement.
- Initial imports of older posts use follower count at first observation as a
  denominator proxy. Exact historical follower counts are unavailable through
  the current integration.
- A small held-out period can omit a class; fixed-label metrics report zero
  support rather than hiding the absence. Missing test classes or zero recall
  for any represented class make the academic evaluation `exploratory`.
- Tercile thresholds are relative design choices, not universal business
  definitions of low or high performance, and can change after retraining.
- The three tiers are ordinal. Accuracy alone cannot express that a
  `LOW`-to-`HIGH` mistake is more severe than a `LOW`-to-`AVERAGE` mistake.
- Expanding-window folds improve temporal evidence but cannot remove the
  dependence between posts from the same brand or guarantee generalization to a
  new brand.
- Continuous production drift monitoring and enterprise deployment controls are future work.

## Final evidence command

After the final sync/retrain:

```powershell
docker compose exec -T ml-service python -m app.thesis_evidence --format markdown | Out-File -Encoding utf8 .\docs\FINAL_MODEL_EVIDENCE.md
```

The generated report must be reviewed alongside the dataset description in the
written thesis. Confirm that every final model includes comparator evidence,
temporal-validation evidence, scientific status, class support, and ordinal
metrics. A software test pass does not substitute for interpreting empirical
model results, and an exploratory model must be presented explicitly as such.
