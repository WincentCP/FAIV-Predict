# Bachelor-thesis machine-learning method

## Research artifact

FAIV Predict classifies a planned Instagram post into `LOW`, `AVERAGE`, or `HIGH` historical engagement-performance tiers. It is a decision-support classifier, not a causal estimator of reach, sales, or guaranteed uplift.

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

`follower_count_at_post` is the column's historical name. For a post first
observed near publication it approximates the audience at posting; for older
posts imported during the initial synchronization it is the follower count at
first observation. It must therefore not be described as an exact historical
denominator. The seven-day maturity gate reduces immature-label bias, but the
prototype still uses cumulative metrics observed at the latest sync rather than
an exact fixed seven-day snapshot.

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

Every candidate is compared with a `DummyClassifier(strategy="most_frequent")`. The model is not academically justified merely by reporting accuracy; it must be interpreted against this baseline and its per-class behavior.

A candidate is promoted only when held-out accuracy is strictly higher than
the majority-class baseline. A rejected candidate writes one of at most five
local evaluation artifacts per scope for temporary diagnosis but is not
uploaded or registered, so the previous working model remains active. These
rejection diagnostics are not durable thesis evidence and may disappear when
the container is recreated. Missing classes in the held-out period are recorded
as an explicit warning because that period cannot evaluate those classes.

## Reported evidence

The evaluation contract `faiv-thesis-v1` stores:

- accuracy gain over baseline;
- macro and weighted precision, recall, and F1;
- per-class precision, recall, F1, and support;
- fixed-order confusion matrix;
- training and test class distributions;
- sample counts and data time window;
- P33/P67 values;
- promotion decision and warnings;
- empirical training-hour counts;
- model parameters;
- dataset SHA-256;
- training/preprocessing source SHA-256;
- Python, NumPy, pandas, scikit-learn, and requirements-file versions/hashes.

Macro metrics prevent a large class from hiding failure on another class. Weighted metrics describe aggregate performance under the observed held-out distribution. Per-class metrics and the confusion matrix remain the primary diagnostic evidence.

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
- A small held-out period can omit a class; fixed-label metrics report zero support rather than hiding the absence.
- Continuous production drift monitoring and enterprise deployment controls are future work.

## Final evidence command

After the final sync/retrain:

```powershell
docker compose exec -T ml-service python -m app.thesis_evidence --format markdown | Out-File -Encoding utf8 .\docs\FINAL_MODEL_EVIDENCE.md
```

The generated report must be reviewed alongside the dataset description in the written thesis; a software test pass does not substitute for interpreting empirical model results.
