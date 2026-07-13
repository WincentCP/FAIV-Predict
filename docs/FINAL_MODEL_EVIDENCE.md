# FAIV Predict final model evidence

Generated from the latest application-append-only `models.metrics` records. Raw captions and secrets are excluded.

| Scope | Version | Scientific status | Train/Test | Accuracy | Macro F1 | Balanced accuracy | Dummy accuracy | Logistic accuracy | Accuracy gain | Ordinal MAE | QWK | Dataset SHA-256 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Fitness | 20260712152458881536_d3c06d7b | exploratory | 45/12 | 0.8333 | 0.6333 | 0.6667 | 0.1667 | 0.7500 | 0.6667 | 0.1667 | 0.7692 | `e044b7da88c796859d5670673beafc62719a175ead344d5e9e2b53ee9e83b287` |
| Lasence Bakeshop | 20260712152451968779_dafbd5a3 | validated | 398/100 | 0.4100 | 0.4047 | 0.4599 | 0.2900 | 0.3900 | 0.1200 | 0.6600 | 0.4576 | `1eef212e53ff663a9762252485d38b918c8622ef142e2ef2ae4cba1eb95422ac` |

## Reproducibility details

### Fitness — 20260712152458881536_d3c06d7b

- Model type: `niche`
- Chronological split: `chronological_80_20`
- Data window: `2025-08-27T04:02:21+00:00` to `2026-07-02T10:05:12+00:00`
- Verified posts: `57`
- Held-out class support (LOW/AVERAGE/HIGH): `1/2/9`
- Scientific status: `exploratory`
- Scientific decision: `exploratory_limit_claims`
- Scientific failure reasons: `no_zero_recall_for_observed_classes, positive_gain_on_majority_of_temporal_folds`
- Temporal folds (evaluated/positive/skipped): `3/1/0`
- Holdout permutation importance available: `True`
- Training code SHA-256: `b3df9ef97253d0a9c604dff10b0ca10b5027fa7d4d32bd4176b969c1f15ee27b`
- Requirements SHA-256: `134c9af9be000bd8dee8dd7b5d420f4f29085ce8321bfc0661c90ebf2be3a638`
- Runtime: Python `3.12.13`, scikit-learn `1.9.0`, pandas `3.0.3`, NumPy `2.5.1`
- Promotion decision: `promote`
- Evaluation contract: `faiv-thesis-v2`

```json
{
  "accuracy": 0.8333333333333334,
  "accuracy_gain_over_baseline": 0.6666666666666667,
  "balanced_accuracy_gain_over_baseline": 0.3333333333333333,
  "baseline": {
    "accuracy": 0.16666666666666666,
    "balanced_accuracy": 0.3333333333333333,
    "confusion_matrix": {
      "labels": [
        "LOW",
        "AVERAGE",
        "HIGH"
      ],
      "matrix": [
        [
          0,
          1,
          0
        ],
        [
          0,
          2,
          0
        ],
        [
          0,
          9,
          0
        ]
      ]
    },
    "macro": {
      "f1_score": 0.09523809523809523,
      "precision": 0.05555555555555555,
      "recall": 0.3333333333333333
    },
    "model": "DummyClassifier",
    "ordinal_mae": 0.8333333333333334,
    "per_class": {
      "AVERAGE": {
        "f1_score": 0.2857142857142857,
        "precision": 0.16666666666666666,
        "recall": 1.0,
        "support": 2
      },
      "HIGH": {
        "f1_score": 0.0,
        "precision": 0.0,
        "recall": 0.0,
        "support": 9
      },
      "LOW": {
        "f1_score": 0.0,
        "precision": 0.0,
        "recall": 0.0,
        "support": 1
      }
    },
    "quadratic_weighted_kappa": 0.0,
    "strategy": "most_frequent",
    "weighted": {
      "f1_score": 0.047619047619047616,
      "precision": 0.027777777777777776,
      "recall": 0.16666666666666666
    }
  },
  "candidate": {
    "accuracy": 0.8333333333333334,
    "balanced_accuracy": 0.6666666666666666,
    "confusion_matrix": {
      "labels": [
        "LOW",
        "AVERAGE",
        "HIGH"
      ],
      "matrix": [
        [
          1,
          0,
          0
        ],
        [
          0,
          0,
          2
        ],
        [
          0,
          0,
          9
        ]
      ]
    },
    "macro": {
      "f1_score": 0.6333333333333333,
      "precision": 0.6060606060606061,
      "recall": 0.6666666666666666
    },
    "ordinal_mae": 0.16666666666666666,
    "per_class": {
      "AVERAGE": {
        "f1_score": 0.0,
        "precision": 0.0,
        "recall": 0.0,
        "support": 2
      },
      "HIGH": {
        "f1_score": 0.9,
        "precision": 0.8181818181818182,
        "recall": 1.0,
        "support": 9
      },
      "LOW": {
        "f1_score": 1.0,
        "precision": 1.0,
        "recall": 1.0,
        "support": 1
      }
    },
    "quadratic_weighted_kappa": 0.7692307692307692,
    "weighted": {
      "f1_score": 0.7583333333333333,
      "precision": 0.6969696969696969,
      "recall": 0.8333333333333334
    }
  },
  "comparators": {
    "logistic_regression": {
      "accuracy": 0.75,
      "balanced_accuracy": 0.46296296296296297,
      "confusion_matrix": {
        "labels": [
          "LOW",
          "AVERAGE",
          "HIGH"
        ],
        "matrix": [
          [
            0,
            0,
            1
          ],
          [
            0,
            1,
            1
          ],
          [
            0,
            1,
            8
          ]
        ]
      },
      "macro": {
        "f1_score": 0.4473684210526316,
        "precision": 0.43333333333333335,
        "recall": 0.46296296296296297
      },
      "model": "LogisticRegression",
      "ordinal_mae": 0.3333333333333333,
      "parameters": {
        "max_iter": 1000,
        "random_state": 42
      },
      "per_class": {
        "AVERAGE": {
          "f1_score": 0.5,
          "precision": 0.5,
          "recall": 0.5,
          "support": 2
        },
        "HIGH": {
          "f1_score": 0.8421052631578947,
          "precision": 0.8,
          "recall": 0.8888888888888888,
          "support": 9
        },
        "LOW": {
          "f1_score": 0.0,
          "precision": 0.0,
          "recall": 0.0,
          "support": 1
        }
      },
      "preprocessing": "StandardScaler_fit_on_training_only",
      "quadratic_weighted_kappa": 0.10000000000000009,
      "weighted": {
        "f1_score": 0.7149122807017543,
        "precision": 0.6833333333333332,
        "recall": 0.75
      }
    }
  },
  "data_source": "instagram_graph",
  "dataset": {
    "dataset_sha256": "e044b7da88c796859d5670673beafc62719a175ead344d5e9e2b53ee9e83b287",
    "feature_order": [
      "is_single_image",
      "is_carousel",
      "is_reels",
      "post_hour",
      "caption_length",
      "hashtag_count",
      "has_cta",
      "is_weekend",
      "has_question",
      "emoji_count"
    ],
    "first_post_at": "2025-08-27T04:02:21+00:00",
    "last_post_at": "2026-07-02T10:05:12+00:00",
    "unique_media_ids": 57,
    "verified_posts": 57
  },
  "engagement_observation_policy": "cumulative_at_latest_sync_after_maturity_gate",
  "evaluation_contract": "faiv-thesis-v2",
  "evaluation_status": "exploratory",
  "f1_score": 0.7583333333333333,
  "feature_reference_values": {
    "caption_length_median": 280.0,
    "hashtag_count_median": 5.0
  },
  "holdout_permutation_importance": {
    "available": true,
    "features": [
      {
        "feature": "is_reels",
        "mean": 0.35185185185185186,
        "std": 0.018518518518518517
      },
      {
        "feature": "is_single_image",
        "mean": 0.28888888888888886,
        "std": 0.09979402655783319
      },
      {
        "feature": "emoji_count",
        "mean": 0.03333333333333333,
        "std": 0.09999999999999999
      },
      {
        "feature": "is_carousel",
        "mean": 0.0,
        "std": 0.0
      },
      {
        "feature": "post_hour",
        "mean": 0.0,
        "std": 0.0
      },
      {
        "feature": "caption_length",
        "mean": 0.0,
        "std": 0.0
      },
      {
        "feature": "hashtag_count",
        "mean": 0.0,
        "std": 0.0
      },
      {
        "feature": "has_cta",
        "mean": 0.0,
        "std": 0.0
      },
      {
        "feature": "is_weekend",
        "mean": 0.0,
        "std": 0.0
      },
      {
        "feature": "has_question",
        "mean": 0.0,
        "std": 0.0
      }
    ],
    "n_repeats": 10,
    "random_state": 42,
    "scoring": "balanced_accuracy"
  },
  "identity_key": "instagram_media_id",
  "macro_f1_gain_over_baseline": 0.5380952380952381,
  "minimum_post_age_days": 7,
  "model_parameters": {
    "bootstrap": true,
    "ccp_alpha": 0.0,
    "class_weight": null,
    "criterion": "gini",
    "max_depth": 4,
    "max_features": "sqrt",
    "max_leaf_nodes": null,
    "max_samples": null,
    "min_impurity_decrease": 0.0,
    "min_samples_leaf": 5,
    "min_samples_split": 2,
    "min_weight_fraction_leaf": 0.0,
    "monotonic_cst": null,
    "n_estimators": 100,
    "n_jobs": null,
    "oob_score": false,
    "random_state": 42,
    "verbose": 0,
    "warm_start": false
  },
  "p33_threshold": 2.6941,
  "p67_threshold": 4.158464,
  "post_hour_support": {
    "10": 3,
    "11": 9,
    "12": 7,
    "13": 3,
    "14": 3,
    "15": 3,
    "16": 2,
    "17": 3,
    "18": 1,
    "19": 1,
    "20": 1,
    "21": 1,
    "5": 1,
    "6": 2,
    "7": 1,
    "8": 1,
    "9": 3
  },
  "precision": 0.6969696969696969,
  "promotion_gate": {
    "decision": "promote",
    "hard_criteria": {
      "accuracy_gain_over_majority_baseline_gt_zero": true,
      "all_training_classes_present": true
    },
    "passed": true,
    "warnings": [
      "held_out_zero_recall_classes:AVERAGE",
      "temporal_majority_gain_not_demonstrated"
    ]
  },
  "recall": 0.8333333333333334,
  "runtime": {
    "numpy": "2.5.1",
    "pandas": "3.0.3",
    "python": "3.12.13",
    "requirements_sha256": "134c9af9be000bd8dee8dd7b5d420f4f29085ce8321bfc0661c90ebf2be3a638",
    "scikit_learn": "1.9.0"
  },
  "scientific_gate": {
    "decision": "exploratory_limit_claims",
    "failure_reasons": [
      "no_zero_recall_for_observed_classes",
      "positive_gain_on_majority_of_temporal_folds"
    ],
    "hard_criteria": {
      "all_held_out_classes_present": true,
      "at_least_two_temporal_folds_evaluated": true,
      "balanced_accuracy_gain_over_baseline_gt_zero": true,
      "macro_f1_gain_over_baseline_gt_zero": true,
      "no_zero_recall_for_observed_classes": false,
      "operational_promotion_passed": true,
      "positive_gain_on_majority_of_temporal_folds": false
    },
    "missing_held_out_classes": [],
    "passed": false,
    "zero_recall_classes": [
      "AVERAGE"
    ]
  },
  "split": "chronological_80_20",
  "temporal_evaluation": {
    "folds": [
      {
        "baseline": {
          "accuracy": 0.09090909090909091,
          "balanced_accuracy": 0.3333333333333333,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                0,
                2,
                0
              ],
              [
                0,
                1,
                0
              ],
              [
                0,
                8,
                0
              ]
            ]
          },
          "macro": {
            "f1_score": 0.05555555555555555,
            "precision": 0.030303030303030304,
            "recall": 0.3333333333333333
          },
          "ordinal_mae": 0.9090909090909091,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.16666666666666666,
              "precision": 0.09090909090909091,
              "recall": 1.0,
              "support": 1
            },
            "HIGH": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 8
            },
            "LOW": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 2
            }
          },
          "quadratic_weighted_kappa": 0.0,
          "weighted": {
            "f1_score": 0.01515151515151515,
            "precision": 0.008264462809917356,
            "recall": 0.09090909090909091
          }
        },
        "candidate": {
          "accuracy": 0.09090909090909091,
          "balanced_accuracy": 0.3333333333333333,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                0,
                2,
                0
              ],
              [
                0,
                1,
                0
              ],
              [
                0,
                8,
                0
              ]
            ]
          },
          "macro": {
            "f1_score": 0.05555555555555555,
            "precision": 0.030303030303030304,
            "recall": 0.3333333333333333
          },
          "ordinal_mae": 0.9090909090909091,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.16666666666666666,
              "precision": 0.09090909090909091,
              "recall": 1.0,
              "support": 1
            },
            "HIGH": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 8
            },
            "LOW": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 2
            }
          },
          "quadratic_weighted_kappa": 0.0,
          "weighted": {
            "f1_score": 0.01515151515151515,
            "precision": 0.008264462809917356,
            "recall": 0.09090909090909091
          }
        },
        "fold": 1,
        "gains_over_baseline": {
          "accuracy": 0.0,
          "balanced_accuracy": 0.0,
          "macro_f1": 0.0
        },
        "logistic_regression": {
          "accuracy": 0.18181818181818182,
          "balanced_accuracy": 0.08333333333333333,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                0,
                2,
                0
              ],
              [
                0,
                0,
                1
              ],
              [
                0,
                6,
                2
              ]
            ]
          },
          "macro": {
            "f1_score": 0.12121212121212122,
            "precision": 0.2222222222222222,
            "recall": 0.08333333333333333
          },
          "ordinal_mae": 0.8181818181818182,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 1
            },
            "HIGH": {
              "f1_score": 0.36363636363636365,
              "precision": 0.6666666666666666,
              "recall": 0.25,
              "support": 8
            },
            "LOW": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 2
            }
          },
          "quadratic_weighted_kappa": 0.07476635514018704,
          "weighted": {
            "f1_score": 0.2644628099173554,
            "precision": 0.4848484848484848,
            "recall": 0.18181818181818182
          }
        },
        "missing_validation_classes": [],
        "p33_threshold": 2.2187,
        "p67_threshold": 2.990508,
        "positive_balanced_accuracy_and_macro_f1_gain": false,
        "status": "evaluated",
        "train_class_distribution": {
          "AVERAGE": 5,
          "HIGH": 4,
          "LOW": 3
        },
        "train_end_index": 11,
        "train_samples": 12,
        "validation_class_distribution": {
          "AVERAGE": 1,
          "HIGH": 8,
          "LOW": 2
        },
        "validation_end_index": 22,
        "validation_samples": 11,
        "validation_start_index": 12
      },
      {
        "baseline": {
          "accuracy": 0.18181818181818182,
          "balanced_accuracy": 0.3333333333333333,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                0,
                0,
                4
              ],
              [
                0,
                0,
                5
              ],
              [
                0,
                0,
                2
              ]
            ]
          },
          "macro": {
            "f1_score": 0.10256410256410257,
            "precision": 0.06060606060606061,
            "recall": 0.3333333333333333
          },
          "ordinal_mae": 1.1818181818181819,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 5
            },
            "HIGH": {
              "f1_score": 0.3076923076923077,
              "precision": 0.18181818181818182,
              "recall": 1.0,
              "support": 2
            },
            "LOW": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 4
            }
          },
          "quadratic_weighted_kappa": 0.0,
          "weighted": {
            "f1_score": 0.055944055944055944,
            "precision": 0.03305785123966942,
            "recall": 0.18181818181818182
          }
        },
        "candidate": {
          "accuracy": 0.18181818181818182,
          "balanced_accuracy": 0.3333333333333333,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                0,
                0,
                4
              ],
              [
                0,
                0,
                5
              ],
              [
                0,
                0,
                2
              ]
            ]
          },
          "macro": {
            "f1_score": 0.10256410256410257,
            "precision": 0.06060606060606061,
            "recall": 0.3333333333333333
          },
          "ordinal_mae": 1.1818181818181819,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 5
            },
            "HIGH": {
              "f1_score": 0.3076923076923077,
              "precision": 0.18181818181818182,
              "recall": 1.0,
              "support": 2
            },
            "LOW": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 4
            }
          },
          "quadratic_weighted_kappa": 0.0,
          "weighted": {
            "f1_score": 0.055944055944055944,
            "precision": 0.03305785123966942,
            "recall": 0.18181818181818182
          }
        },
        "fold": 2,
        "gains_over_baseline": {
          "accuracy": 0.0,
          "balanced_accuracy": 0.0,
          "macro_f1": 0.0
        },
        "logistic_regression": {
          "accuracy": 0.2727272727272727,
          "balanced_accuracy": 0.4166666666666667,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                1,
                0,
                3
              ],
              [
                1,
                0,
                4
              ],
              [
                0,
                0,
                2
              ]
            ]
          },
          "macro": {
            "f1_score": 0.23232323232323235,
            "precision": 0.24074074074074073,
            "recall": 0.4166666666666667
          },
          "ordinal_mae": 1.0,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 5
            },
            "HIGH": {
              "f1_score": 0.36363636363636365,
              "precision": 0.2222222222222222,
              "recall": 1.0,
              "support": 2
            },
            "LOW": {
              "f1_score": 0.3333333333333333,
              "precision": 0.5,
              "recall": 0.25,
              "support": 4
            }
          },
          "quadratic_weighted_kappa": 0.13023255813953494,
          "weighted": {
            "f1_score": 0.18732782369146006,
            "precision": 0.22222222222222224,
            "recall": 0.2727272727272727
          }
        },
        "missing_validation_classes": [],
        "p33_threshold": 2.3629220000000006,
        "p67_threshold": 4.413588000000001,
        "positive_balanced_accuracy_and_macro_f1_gain": false,
        "status": "evaluated",
        "train_class_distribution": {
          "AVERAGE": 7,
          "HIGH": 8,
          "LOW": 8
        },
        "train_end_index": 22,
        "train_samples": 23,
        "validation_class_distribution": {
          "AVERAGE": 5,
          "HIGH": 2,
          "LOW": 4
        },
        "validation_end_index": 33,
        "validation_samples": 11,
        "validation_start_index": 23
      },
      {
        "baseline": {
          "accuracy": 0.45454545454545453,
          "balanced_accuracy": 0.3333333333333333,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                0,
                1,
                0
              ],
              [
                0,
                5,
                0
              ],
              [
                0,
                5,
                0
              ]
            ]
          },
          "macro": {
            "f1_score": 0.20833333333333334,
            "precision": 0.15151515151515152,
            "recall": 0.3333333333333333
          },
          "ordinal_mae": 0.5454545454545454,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.625,
              "precision": 0.45454545454545453,
              "recall": 1.0,
              "support": 5
            },
            "HIGH": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 5
            },
            "LOW": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 1
            }
          },
          "quadratic_weighted_kappa": 0.0,
          "weighted": {
            "f1_score": 0.2840909090909091,
            "precision": 0.20661157024793386,
            "recall": 0.45454545454545453
          }
        },
        "candidate": {
          "accuracy": 0.36363636363636365,
          "balanced_accuracy": 0.5333333333333333,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                1,
                0,
                0
              ],
              [
                1,
                2,
                2
              ],
              [
                0,
                4,
                1
              ]
            ]
          },
          "macro": {
            "f1_score": 0.42676767676767674,
            "precision": 0.38888888888888884,
            "recall": 0.5333333333333333
          },
          "ordinal_mae": 0.6363636363636364,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.36363636363636365,
              "precision": 0.3333333333333333,
              "recall": 0.4,
              "support": 5
            },
            "HIGH": {
              "f1_score": 0.25,
              "precision": 0.3333333333333333,
              "recall": 0.2,
              "support": 5
            },
            "LOW": {
              "f1_score": 0.6666666666666666,
              "precision": 0.5,
              "recall": 1.0,
              "support": 1
            }
          },
          "quadratic_weighted_kappa": 0.31858407079646023,
          "weighted": {
            "f1_score": 0.33953168044077137,
            "precision": 0.34848484848484845,
            "recall": 0.36363636363636365
          }
        },
        "fold": 3,
        "gains_over_baseline": {
          "accuracy": -0.09090909090909088,
          "balanced_accuracy": 0.2,
          "macro_f1": 0.2184343434343434
        },
        "logistic_regression": {
          "accuracy": 0.6363636363636364,
          "balanced_accuracy": 0.7333333333333334,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                1,
                0,
                0
              ],
              [
                0,
                4,
                1
              ],
              [
                1,
                2,
                2
              ]
            ]
          },
          "macro": {
            "f1_score": 0.6313131313131314,
            "precision": 0.611111111111111,
            "recall": 0.7333333333333334
          },
          "ordinal_mae": 0.45454545454545453,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.7272727272727273,
              "precision": 0.6666666666666666,
              "recall": 0.8,
              "support": 5
            },
            "HIGH": {
              "f1_score": 0.5,
              "precision": 0.6666666666666666,
              "recall": 0.4,
              "support": 5
            },
            "LOW": {
              "f1_score": 0.6666666666666666,
              "precision": 0.5,
              "recall": 1.0,
              "support": 1
            }
          },
          "quadratic_weighted_kappa": 0.31858407079646023,
          "weighted": {
            "f1_score": 0.6184573002754822,
            "precision": 0.6515151515151515,
            "recall": 0.6363636363636364
          }
        },
        "missing_validation_classes": [],
        "p33_threshold": 2.2187,
        "p67_threshold": 4.1204,
        "positive_balanced_accuracy_and_macro_f1_gain": true,
        "status": "evaluated",
        "train_class_distribution": {
          "AVERAGE": 15,
          "HIGH": 10,
          "LOW": 9
        },
        "train_end_index": 33,
        "train_samples": 34,
        "validation_class_distribution": {
          "AVERAGE": 5,
          "HIGH": 5,
          "LOW": 1
        },
        "validation_end_index": 44,
        "validation_samples": 11,
        "validation_start_index": 34
      }
    ],
    "method": "expanding_window_on_training_portion",
    "minimum_fold_train_samples": 12,
    "requested_splits": 3,
    "summary": {
      "evaluated_folds": 3,
      "majority_positive_gain": false,
      "positive_gain_folds": 1,
      "skipped_folds": 0,
      "status": "complete",
      "sufficient_evidence": true
    },
    "threshold_policy": "recomputed_from_each_fold_training_window"
  },
  "test_class_distribution": {
    "AVERAGE": 2,
    "HIGH": 9,
    "LOW": 1
  },
  "test_samples": 12,
  "train_class_distribution": {
    "AVERAGE": 16,
    "HIGH": 15,
    "LOW": 14
  },
  "train_samples": 45,
  "training_code_sha256": "b3df9ef97253d0a9c604dff10b0ca10b5027fa7d4d32bd4176b969c1f15ee27b",
  "verified_posts": 57
}
```

### Lasence Bakeshop — 20260712152451968779_dafbd5a3

- Model type: `account`
- Chronological split: `chronological_80_20`
- Data window: `2024-03-14T06:09:54+00:00` to `2026-07-01T08:36:34+00:00`
- Verified posts: `498`
- Held-out class support (LOW/AVERAGE/HIGH): `47/29/24`
- Scientific status: `validated`
- Scientific decision: `validated_for_thesis_claim`
- Scientific failure reasons: `none`
- Temporal folds (evaluated/positive/skipped): `3/3/0`
- Holdout permutation importance available: `True`
- Training code SHA-256: `b3df9ef97253d0a9c604dff10b0ca10b5027fa7d4d32bd4176b969c1f15ee27b`
- Requirements SHA-256: `134c9af9be000bd8dee8dd7b5d420f4f29085ce8321bfc0661c90ebf2be3a638`
- Runtime: Python `3.12.13`, scikit-learn `1.9.0`, pandas `3.0.3`, NumPy `2.5.1`
- Promotion decision: `promote`
- Evaluation contract: `faiv-thesis-v2`

```json
{
  "accuracy": 0.41,
  "accuracy_gain_over_baseline": 0.12,
  "balanced_accuracy_gain_over_baseline": 0.1265896307165566,
  "baseline": {
    "accuracy": 0.29,
    "balanced_accuracy": 0.3333333333333333,
    "confusion_matrix": {
      "labels": [
        "LOW",
        "AVERAGE",
        "HIGH"
      ],
      "matrix": [
        [
          0,
          47,
          0
        ],
        [
          0,
          29,
          0
        ],
        [
          0,
          24,
          0
        ]
      ]
    },
    "macro": {
      "f1_score": 0.14987080103359174,
      "precision": 0.09666666666666666,
      "recall": 0.3333333333333333
    },
    "model": "DummyClassifier",
    "ordinal_mae": 0.71,
    "per_class": {
      "AVERAGE": {
        "f1_score": 0.4496124031007752,
        "precision": 0.29,
        "recall": 1.0,
        "support": 29
      },
      "HIGH": {
        "f1_score": 0.0,
        "precision": 0.0,
        "recall": 0.0,
        "support": 24
      },
      "LOW": {
        "f1_score": 0.0,
        "precision": 0.0,
        "recall": 0.0,
        "support": 47
      }
    },
    "quadratic_weighted_kappa": 0.0,
    "strategy": "most_frequent",
    "weighted": {
      "f1_score": 0.1303875968992248,
      "precision": 0.08410000000000001,
      "recall": 0.29
    }
  },
  "candidate": {
    "accuracy": 0.41,
    "balanced_accuracy": 0.4599229640498899,
    "confusion_matrix": {
      "labels": [
        "LOW",
        "AVERAGE",
        "HIGH"
      ],
      "matrix": [
        [
          14,
          28,
          5
        ],
        [
          4,
          6,
          19
        ],
        [
          2,
          1,
          21
        ]
      ]
    },
    "macro": {
      "f1_score": 0.40470203331170235,
      "precision": 0.44603174603174606,
      "recall": 0.4599229640498899
    },
    "ordinal_mae": 0.66,
    "per_class": {
      "AVERAGE": {
        "f1_score": 0.1875,
        "precision": 0.17142857142857143,
        "recall": 0.20689655172413793,
        "support": 29
      },
      "HIGH": {
        "f1_score": 0.6086956521739131,
        "precision": 0.4666666666666667,
        "recall": 0.875,
        "support": 24
      },
      "LOW": {
        "f1_score": 0.417910447761194,
        "precision": 0.7,
        "recall": 0.2978723404255319,
        "support": 47
      }
    },
    "quadratic_weighted_kappa": 0.4576271186440678,
    "weighted": {
      "f1_score": 0.39687986696950034,
      "precision": 0.4907142857142857,
      "recall": 0.41
    }
  },
  "comparators": {
    "logistic_regression": {
      "accuracy": 0.39,
      "balanced_accuracy": 0.4297505502567865,
      "confusion_matrix": {
        "labels": [
          "LOW",
          "AVERAGE",
          "HIGH"
        ],
        "matrix": [
          [
            14,
            28,
            5
          ],
          [
            3,
            7,
            19
          ],
          [
            0,
            6,
            18
          ]
        ]
      },
      "macro": {
        "f1_score": 0.3943181818181818,
        "precision": 0.47427751588440253,
        "recall": 0.4297505502567865
      },
      "model": "LogisticRegression",
      "ordinal_mae": 0.66,
      "parameters": {
        "max_iter": 1000,
        "random_state": 42
      },
      "per_class": {
        "AVERAGE": {
          "f1_score": 0.2,
          "precision": 0.17073170731707318,
          "recall": 0.2413793103448276,
          "support": 29
        },
        "HIGH": {
          "f1_score": 0.5454545454545454,
          "precision": 0.42857142857142855,
          "recall": 0.75,
          "support": 24
        },
        "LOW": {
          "f1_score": 0.4375,
          "precision": 0.8235294117647058,
          "recall": 0.2978723404255319,
          "support": 47
        }
      },
      "preprocessing": "StandardScaler_fit_on_training_only",
      "quadratic_weighted_kappa": 0.46289752650176674,
      "weighted": {
        "f1_score": 0.3945340909090909,
        "precision": 0.5394281615085058,
        "recall": 0.39
      }
    }
  },
  "data_source": "instagram_graph",
  "dataset": {
    "dataset_sha256": "1eef212e53ff663a9762252485d38b918c8622ef142e2ef2ae4cba1eb95422ac",
    "feature_order": [
      "is_single_image",
      "is_carousel",
      "is_reels",
      "post_hour",
      "caption_length",
      "hashtag_count",
      "has_cta",
      "is_weekend",
      "has_question",
      "emoji_count"
    ],
    "first_post_at": "2024-03-14T06:09:54+00:00",
    "last_post_at": "2026-07-01T08:36:34+00:00",
    "unique_media_ids": 498,
    "verified_posts": 498
  },
  "engagement_observation_policy": "cumulative_at_latest_sync_after_maturity_gate",
  "evaluation_contract": "faiv-thesis-v2",
  "evaluation_status": "validated",
  "f1_score": 0.39687986696950034,
  "feature_reference_values": {
    "caption_length_median": 480.5,
    "hashtag_count_median": 15.0
  },
  "holdout_permutation_importance": {
    "available": true,
    "features": [
      {
        "feature": "is_reels",
        "mean": 0.14865594684927036,
        "std": 0.026262605900832972
      },
      {
        "feature": "has_question",
        "mean": 0.012643678160919524,
        "std": 0.008045977011494244
      },
      {
        "feature": "has_cta",
        "mean": 0.010907312301296134,
        "std": 0.01126467682854638
      },
      {
        "feature": "hashtag_count",
        "mean": 0.0,
        "std": 0.0
      },
      {
        "feature": "emoji_count",
        "mean": -0.002445585717779436,
        "std": 0.01588539234362361
      },
      {
        "feature": "is_single_image",
        "mean": -0.003143596641395635,
        "std": 0.012499871908626834
      },
      {
        "feature": "is_carousel",
        "mean": -0.010662753729518266,
        "std": 0.012205506466209848
      },
      {
        "feature": "is_weekend",
        "mean": -0.02198581560283691,
        "std": 0.008055189142979109
      },
      {
        "feature": "post_hour",
        "mean": -0.03130349718757647,
        "std": 0.01891878303215958
      },
      {
        "feature": "caption_length",
        "mean": -0.03394472976277821,
        "std": 0.017544516716226102
      }
    ],
    "n_repeats": 10,
    "random_state": 42,
    "scoring": "balanced_accuracy"
  },
  "identity_key": "instagram_media_id",
  "macro_f1_gain_over_baseline": 0.2548312322781106,
  "minimum_post_age_days": 7,
  "model_parameters": {
    "bootstrap": true,
    "ccp_alpha": 0.0,
    "class_weight": null,
    "criterion": "gini",
    "max_depth": 4,
    "max_features": "sqrt",
    "max_leaf_nodes": null,
    "max_samples": null,
    "min_impurity_decrease": 0.0,
    "min_samples_leaf": 5,
    "min_samples_split": 2,
    "min_weight_fraction_leaf": 0.0,
    "monotonic_cst": null,
    "n_estimators": 100,
    "n_jobs": null,
    "oob_score": false,
    "random_state": 42,
    "verbose": 0,
    "warm_start": false
  },
  "p33_threshold": 0.0517,
  "p67_threshold": 0.0804,
  "post_hour_support": {
    "10": 57,
    "11": 91,
    "12": 34,
    "13": 39,
    "14": 43,
    "15": 46,
    "16": 13,
    "17": 6,
    "18": 4,
    "19": 4,
    "20": 2,
    "21": 1,
    "7": 3,
    "8": 26,
    "9": 29
  },
  "precision": 0.4907142857142857,
  "promotion_gate": {
    "decision": "promote",
    "hard_criteria": {
      "accuracy_gain_over_majority_baseline_gt_zero": true,
      "all_training_classes_present": true
    },
    "passed": true,
    "warnings": []
  },
  "recall": 0.41,
  "runtime": {
    "numpy": "2.5.1",
    "pandas": "3.0.3",
    "python": "3.12.13",
    "requirements_sha256": "134c9af9be000bd8dee8dd7b5d420f4f29085ce8321bfc0661c90ebf2be3a638",
    "scikit_learn": "1.9.0"
  },
  "scientific_gate": {
    "decision": "validated_for_thesis_claim",
    "failure_reasons": [],
    "hard_criteria": {
      "all_held_out_classes_present": true,
      "at_least_two_temporal_folds_evaluated": true,
      "balanced_accuracy_gain_over_baseline_gt_zero": true,
      "macro_f1_gain_over_baseline_gt_zero": true,
      "no_zero_recall_for_observed_classes": true,
      "operational_promotion_passed": true,
      "positive_gain_on_majority_of_temporal_folds": true
    },
    "missing_held_out_classes": [],
    "passed": true,
    "zero_recall_classes": []
  },
  "split": "chronological_80_20",
  "temporal_evaluation": {
    "folds": [
      {
        "baseline": {
          "accuracy": 0.3333333333333333,
          "balanced_accuracy": 0.3333333333333333,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                0,
                38,
                0
              ],
              [
                0,
                33,
                0
              ],
              [
                0,
                28,
                0
              ]
            ]
          },
          "macro": {
            "f1_score": 0.16666666666666666,
            "precision": 0.1111111111111111,
            "recall": 0.3333333333333333
          },
          "ordinal_mae": 0.6666666666666666,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.5,
              "precision": 0.3333333333333333,
              "recall": 1.0,
              "support": 33
            },
            "HIGH": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 28
            },
            "LOW": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 38
            }
          },
          "quadratic_weighted_kappa": 0.0,
          "weighted": {
            "f1_score": 0.16666666666666666,
            "precision": 0.1111111111111111,
            "recall": 0.3333333333333333
          }
        },
        "candidate": {
          "accuracy": 0.36363636363636365,
          "balanced_accuracy": 0.38623072833599154,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                2,
                35,
                1
              ],
              [
                8,
                20,
                5
              ],
              [
                5,
                9,
                14
              ]
            ]
          },
          "macro": {
            "f1_score": 0.35705872182238646,
            "precision": 0.3819444444444444,
            "recall": 0.38623072833599154
          },
          "ordinal_mae": 0.696969696969697,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.41237113402061853,
              "precision": 0.3125,
              "recall": 0.6060606060606061,
              "support": 33
            },
            "HIGH": {
              "f1_score": 0.5833333333333334,
              "precision": 0.7,
              "recall": 0.5,
              "support": 28
            },
            "LOW": {
              "f1_score": 0.07547169811320754,
              "precision": 0.13333333333333333,
              "recall": 0.05263157894736842,
              "support": 38
            }
          },
          "quadratic_weighted_kappa": 0.20596098623626102,
          "weighted": {
            "f1_score": 0.3314091442860165,
            "precision": 0.3533249158249158,
            "recall": 0.36363636363636365
          }
        },
        "fold": 1,
        "gains_over_baseline": {
          "accuracy": 0.03030303030303033,
          "balanced_accuracy": 0.05289739500265822,
          "macro_f1": 0.1903920551557198
        },
        "logistic_regression": {
          "accuracy": 0.41414141414141414,
          "balanced_accuracy": 0.4252487278803068,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                12,
                25,
                1
              ],
              [
                14,
                14,
                5
              ],
              [
                8,
                5,
                15
              ]
            ]
          },
          "macro": {
            "f1_score": 0.43640486497629355,
            "precision": 0.46180290297937354,
            "recall": 0.4252487278803068
          },
          "ordinal_mae": 0.6767676767676768,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.36363636363636365,
              "precision": 0.3181818181818182,
              "recall": 0.42424242424242425,
              "support": 33
            },
            "HIGH": {
              "f1_score": 0.6122448979591837,
              "precision": 0.7142857142857143,
              "recall": 0.5357142857142857,
              "support": 28
            },
            "LOW": {
              "f1_score": 0.3333333333333333,
              "precision": 0.35294117647058826,
              "recall": 0.3157894736842105,
              "support": 38
            }
          },
          "quadratic_weighted_kappa": 0.28193531871320066,
          "weighted": {
            "f1_score": 0.4223184223184223,
            "precision": 0.4435531788472965,
            "recall": 0.41414141414141414
          }
        },
        "missing_validation_classes": [],
        "p33_threshold": 0.0517,
        "p67_threshold": 0.0862,
        "positive_balanced_accuracy_and_macro_f1_gain": true,
        "status": "evaluated",
        "train_class_distribution": {
          "AVERAGE": 36,
          "HIGH": 32,
          "LOW": 33
        },
        "train_end_index": 100,
        "train_samples": 101,
        "validation_class_distribution": {
          "AVERAGE": 33,
          "HIGH": 28,
          "LOW": 38
        },
        "validation_end_index": 199,
        "validation_samples": 99,
        "validation_start_index": 101
      },
      {
        "baseline": {
          "accuracy": 0.5252525252525253,
          "balanced_accuracy": 0.3333333333333333,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                0,
                12,
                0
              ],
              [
                0,
                52,
                0
              ],
              [
                0,
                35,
                0
              ]
            ]
          },
          "macro": {
            "f1_score": 0.22958057395143486,
            "precision": 0.1750841750841751,
            "recall": 0.3333333333333333
          },
          "ordinal_mae": 0.47474747474747475,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.6887417218543046,
              "precision": 0.5252525252525253,
              "recall": 1.0,
              "support": 52
            },
            "HIGH": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 35
            },
            "LOW": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 12
            }
          },
          "quadratic_weighted_kappa": 0.0,
          "weighted": {
            "f1_score": 0.36176332865074584,
            "precision": 0.2758902152841547,
            "recall": 0.5252525252525253
          }
        },
        "candidate": {
          "accuracy": 0.45454545454545453,
          "balanced_accuracy": 0.4156898656898657,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                1,
                4,
                7
              ],
              [
                8,
                10,
                34
              ],
              [
                0,
                1,
                34
              ]
            ]
          },
          "macro": {
            "f1_score": 0.3373091253688269,
            "precision": 0.41037037037037033,
            "recall": 0.4156898656898657
          },
          "ordinal_mae": 0.6161616161616161,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.29850746268656714,
              "precision": 0.6666666666666666,
              "recall": 0.19230769230769232,
              "support": 52
            },
            "HIGH": {
              "f1_score": 0.6181818181818182,
              "precision": 0.4533333333333333,
              "recall": 0.9714285714285714,
              "support": 35
            },
            "LOW": {
              "f1_score": 0.09523809523809523,
              "precision": 0.1111111111111111,
              "recall": 0.08333333333333333,
              "support": 12
            }
          },
          "quadratic_weighted_kappa": 0.25249169435215935,
          "weighted": {
            "f1_score": 0.38688493776689165,
            "precision": 0.5239057239057239,
            "recall": 0.45454545454545453
          }
        },
        "fold": 2,
        "gains_over_baseline": {
          "accuracy": -0.07070707070707077,
          "balanced_accuracy": 0.0823565323565324,
          "macro_f1": 0.10772855141739204
        },
        "logistic_regression": {
          "accuracy": 0.494949494949495,
          "balanced_accuracy": 0.41373626373626377,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                0,
                8,
                4
              ],
              [
                1,
                17,
                34
              ],
              [
                0,
                3,
                32
              ]
            ]
          },
          "macro": {
            "f1_score": 0.3448412698412699,
            "precision": 0.3547619047619048,
            "recall": 0.41373626373626377
          },
          "ordinal_mae": 0.5454545454545454,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.425,
              "precision": 0.6071428571428571,
              "recall": 0.3269230769230769,
              "support": 52
            },
            "HIGH": {
              "f1_score": 0.6095238095238096,
              "precision": 0.45714285714285713,
              "recall": 0.9142857142857143,
              "support": 35
            },
            "LOW": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 12
            }
          },
          "quadratic_weighted_kappa": 0.278561354019746,
          "weighted": {
            "f1_score": 0.43872053872053873,
            "precision": 0.4805194805194805,
            "recall": 0.494949494949495
          }
        },
        "missing_validation_classes": [],
        "p33_threshold": 0.046,
        "p67_threshold": 0.08231400000000007,
        "positive_balanced_accuracy_and_macro_f1_gain": true,
        "status": "evaluated",
        "train_class_distribution": {
          "AVERAGE": 80,
          "HIGH": 66,
          "LOW": 54
        },
        "train_end_index": 199,
        "train_samples": 200,
        "validation_class_distribution": {
          "AVERAGE": 52,
          "HIGH": 35,
          "LOW": 12
        },
        "validation_end_index": 298,
        "validation_samples": 99,
        "validation_start_index": 200
      },
      {
        "baseline": {
          "accuracy": 0.35353535353535354,
          "balanced_accuracy": 0.3333333333333333,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                0,
                36,
                0
              ],
              [
                0,
                35,
                0
              ],
              [
                0,
                28,
                0
              ]
            ]
          },
          "macro": {
            "f1_score": 0.17412935323383083,
            "precision": 0.11784511784511785,
            "recall": 0.3333333333333333
          },
          "ordinal_mae": 0.6464646464646465,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.5223880597014925,
              "precision": 0.35353535353535354,
              "recall": 1.0,
              "support": 35
            },
            "HIGH": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 28
            },
            "LOW": {
              "f1_score": 0.0,
              "precision": 0.0,
              "recall": 0.0,
              "support": 36
            }
          },
          "quadratic_weighted_kappa": 0.0,
          "weighted": {
            "f1_score": 0.18468264736921453,
            "precision": 0.12498724619936741,
            "recall": 0.35353535353535354
          }
        },
        "candidate": {
          "accuracy": 0.46464646464646464,
          "balanced_accuracy": 0.4682539682539682,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                3,
                33,
                0
              ],
              [
                3,
                30,
                2
              ],
              [
                0,
                15,
                13
              ]
            ]
          },
          "macro": {
            "f1_score": 0.42616058565842474,
            "precision": 0.5837606837606838,
            "recall": 0.4682539682539682
          },
          "ordinal_mae": 0.5353535353535354,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.5309734513274337,
              "precision": 0.38461538461538464,
              "recall": 0.8571428571428571,
              "support": 35
            },
            "HIGH": {
              "f1_score": 0.6046511627906976,
              "precision": 0.8666666666666667,
              "recall": 0.4642857142857143,
              "support": 28
            },
            "LOW": {
              "f1_score": 0.14285714285714285,
              "precision": 0.5,
              "recall": 0.08333333333333333,
              "support": 36
            }
          },
          "quadratic_weighted_kappa": 0.3869610935856992,
          "weighted": {
            "f1_score": 0.41067838886320057,
            "precision": 0.5629111629111628,
            "recall": 0.46464646464646464
          }
        },
        "fold": 3,
        "gains_over_baseline": {
          "accuracy": 0.1111111111111111,
          "balanced_accuracy": 0.13492063492063489,
          "macro_f1": 0.2520312324245939
        },
        "logistic_regression": {
          "accuracy": 0.45454545454545453,
          "balanced_accuracy": 0.4417989417989418,
          "confusion_matrix": {
            "labels": [
              "LOW",
              "AVERAGE",
              "HIGH"
            ],
            "matrix": [
              [
                13,
                23,
                0
              ],
              [
                8,
                25,
                2
              ],
              [
                6,
                15,
                7
              ]
            ]
          },
          "macro": {
            "f1_score": 0.433760290903148,
            "precision": 0.5520282186948854,
            "recall": 0.4417989417989418
          },
          "ordinal_mae": 0.6060606060606061,
          "per_class": {
            "AVERAGE": {
              "f1_score": 0.5102040816326531,
              "precision": 0.3968253968253968,
              "recall": 0.7142857142857143,
              "support": 35
            },
            "HIGH": {
              "f1_score": 0.3783783783783784,
              "precision": 0.7777777777777778,
              "recall": 0.25,
              "support": 28
            },
            "LOW": {
              "f1_score": 0.4126984126984127,
              "precision": 0.48148148148148145,
              "recall": 0.3611111111111111,
              "support": 36
            }
          },
          "quadratic_weighted_kappa": 0.2584269662921348,
          "weighted": {
            "f1_score": 0.4374634374634374,
            "precision": 0.5353535353535354,
            "recall": 0.45454545454545453
          }
        },
        "missing_validation_classes": [],
        "p33_threshold": 0.0517,
        "p67_threshold": 0.0862,
        "positive_balanced_accuracy_and_macro_f1_gain": true,
        "status": "evaluated",
        "train_class_distribution": {
          "AVERAGE": 120,
          "HIGH": 91,
          "LOW": 88
        },
        "train_end_index": 298,
        "train_samples": 299,
        "validation_class_distribution": {
          "AVERAGE": 35,
          "HIGH": 28,
          "LOW": 36
        },
        "validation_end_index": 397,
        "validation_samples": 99,
        "validation_start_index": 299
      }
    ],
    "method": "expanding_window_on_training_portion",
    "minimum_fold_train_samples": 12,
    "requested_splits": 3,
    "summary": {
      "evaluated_folds": 3,
      "majority_positive_gain": true,
      "positive_gain_folds": 3,
      "skipped_folds": 0,
      "status": "complete",
      "sufficient_evidence": true
    },
    "threshold_policy": "recomputed_from_each_fold_training_window"
  },
  "test_class_distribution": {
    "AVERAGE": 29,
    "HIGH": 24,
    "LOW": 47
  },
  "test_samples": 100,
  "train_class_distribution": {
    "AVERAGE": 144,
    "HIGH": 130,
    "LOW": 124
  },
  "train_samples": 398,
  "training_code_sha256": "b3df9ef97253d0a9c604dff10b0ca10b5027fa7d4d32bd4176b969c1f15ee27b",
  "verified_posts": 498
}
```

## Interpretation boundary

- `validated` means every implemented scientific gate passed for this internal temporal evaluation; it does not prove external validity for unrepresented brands or future Instagram regimes.
- `exploratory` is an honest usable result with insufficient or inconsistent scientific evidence. It must not be reported as validated merely because the operational promotion gate passed.
- Raw Random Forest class scores are not calibrated probabilities, and counterfactual score changes are not causal engagement uplift.
- The outcome is a relative cumulative likes-and-comments tier using the follower count captured at first observation, not an exact fixed seven-day outcome.

