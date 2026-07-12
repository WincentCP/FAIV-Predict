"""Create anonymized, thesis-ready usability evidence from real responses.

The script never invents participants or fills missing answers. Copy the CSV
template, collect one row per participant, then run:

    python scripts/analyze_usability.py docs/usability_responses.csv \
        --output docs/FINAL_USABILITY_EVIDENCE.md
"""

from __future__ import annotations

import argparse
import csv
import statistics
from pathlib import Path
from typing import Dict, Iterable, List


SUS_COLUMNS = [f"sus_{index}" for index in range(1, 11)]
TASKS = {
    "u01": "Create a prediction with a posting time",
    "u02": "Interpret the relative tier, raw score, and one limitation",
    "u03": "Create and interpret a provisional prediction",
    "u04": "Edit an input and recalculate the stale prediction",
    "u05": "Find model/version and validation evidence",
    "u06": "Recover from a safe unavailable/error state",
}
TASK_COLUMNS = [
    f"{task}_{suffix}"
    for task in TASKS
    for suffix in ("completion", "time_seconds", "errors", "seq")
]
REQUIRED_COLUMNS = [
    "participant_id",
    "role",
    *TASK_COLUMNS,
    *SUS_COLUMNS,
    "comments",
]


def _integer(row: Dict[str, str], column: str, *, minimum: int, maximum: int) -> int:
    raw = (row.get(column) or "").strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{column} must be an integer for participant {row.get('participant_id')!r}") from exc
    if not minimum <= value <= maximum:
        raise ValueError(
            f"{column} must be between {minimum} and {maximum} "
            f"for participant {row.get('participant_id')!r}"
        )
    return value


def _completion(row: Dict[str, str], column: str) -> float:
    raw = (row.get(column) or "").strip()
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(
            f"{column} must be 0, 0.5, or 1 for participant {row.get('participant_id')!r}"
        ) from exc
    if value not in (0.0, 0.5, 1.0):
        raise ValueError(
            f"{column} must be 0, 0.5, or 1 for participant {row.get('participant_id')!r}"
        )
    return value


def sus_score(row: Dict[str, str]) -> float:
    """Calculate the standard 0-100 SUS score from ten 1-5 responses."""
    contribution = 0
    for index, column in enumerate(SUS_COLUMNS, start=1):
        value = _integer(row, column, minimum=1, maximum=5)
        contribution += value - 1 if index % 2 else 5 - value
    return contribution * 2.5


def read_rows(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = [column for column in REQUIRED_COLUMNS if column not in (reader.fieldnames or [])]
        if missing:
            raise ValueError("CSV is missing required columns: " + ", ".join(missing))
        rows = [dict(row) for row in reader]
    if not rows:
        raise ValueError("CSV has no participant rows; real usability responses are required")
    participant_ids = [(row.get("participant_id") or "").strip() for row in rows]
    if any(not value for value in participant_ids):
        raise ValueError("Every row requires an anonymized participant_id")
    if len(set(participant_ids)) != len(participant_ids):
        raise ValueError("participant_id values must be unique")
    return rows


def render_markdown(rows: Iterable[Dict[str, str]], minimum_participants: int) -> str:
    rows = list(rows)
    scores = [sus_score(row) for row in rows]
    task_results = {}
    for task in TASKS:
        task_results[task] = {
            "completion": [_completion(row, f"{task}_completion") for row in rows],
            "time": [
                _integer(row, f"{task}_time_seconds", minimum=0, maximum=86400)
                for row in rows
            ],
            "errors": [
                _integer(row, f"{task}_errors", minimum=0, maximum=1000)
                for row in rows
            ],
            "seq": [
                _integer(row, f"{task}_seq", minimum=1, maximum=7)
                for row in rows
            ],
        }
    participant_times = [
        sum(task_results[task]["time"][index] for task in TASKS)
        for index in range(len(rows))
    ]
    participant_errors = [
        sum(task_results[task]["errors"][index] for task in TASKS)
        for index in range(len(rows))
    ]
    status = "complete" if len(rows) >= minimum_participants else "limited sample"

    lines = [
        "# FAIV Predict usability evidence",
        "",
        "> Generated only from the supplied anonymized participant rows. "
        "This report does not infer or fabricate missing responses.",
        "",
        f"- Participants: **{len(rows)}**",
        f"- Planned minimum: **{minimum_participants}**",
        f"- Evidence status: **{status}**",
        f"- Mean SUS: **{statistics.mean(scores):.2f}/100**",
        f"- Median SUS: **{statistics.median(scores):.2f}/100**",
        f"- SUS range: **{min(scores):.2f}-{max(scores):.2f}**",
        f"- Median total task time: **{statistics.median(participant_times):.1f} seconds**",
        f"- Total observed user errors: **{sum(participant_errors)}**",
        "",
        "## Task completion",
        "",
        "| Task | Unassisted | With help | Not completed | Unassisted rate | Median time | Median SEQ |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for task, label in TASKS.items():
        values = task_results[task]["completion"]
        unassisted = sum(value == 1.0 for value in values)
        with_help = sum(value == 0.5 for value in values)
        incomplete = sum(value == 0.0 for value in values)
        lines.append(
            f"| {task.upper()} — {label} | {unassisted}/{len(rows)} | "
            f"{with_help}/{len(rows)} | {incomplete}/{len(rows)} | "
            f"{(unassisted / len(rows)) * 100:.1f}% | "
            f"{statistics.median(task_results[task]['time']):.1f}s | "
            f"{statistics.median(task_results[task]['seq']):.1f}/7 |"
        )

    lines.extend([
        "",
        "## Participant-level audit table",
        "",
        "| Participant | Role | SUS | Completion time (s) | Errors |",
        "| --- | --- | ---: | ---: | ---: |",
    ])
    for row, score, seconds, errors in zip(rows, scores, participant_times, participant_errors):
        participant = (row.get("participant_id") or "").replace("|", "\\|")
        role = (row.get("role") or "unspecified").replace("|", "\\|")
        lines.append(f"| {participant} | {role} | {score:.1f} | {seconds} | {errors} |")

    comments = [
        ((row.get("participant_id") or "").strip(), (row.get("comments") or "").strip())
        for row in rows
        if (row.get("comments") or "").strip()
    ]
    lines.extend(["", "## Qualitative observations", ""])
    if comments:
        for participant, comment in comments:
            lines.append(f"- **{participant}:** {comment}")
    else:
        lines.append("No qualitative comments were recorded.")

    lines.extend([
        "",
        "## Interpretation boundary",
        "",
        "This is a small, thesis-scope usability evaluation. Report the participant "
        "recruitment method and user roles in the thesis; do not generalize the result "
        "to all enterprise users or treat SUS as evidence of ML accuracy.",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--minimum-participants", type=int, default=5)
    args = parser.parse_args()
    if args.minimum_participants < 1:
        parser.error("--minimum-participants must be at least 1")

    rendered = render_markdown(read_rows(args.csv_path), args.minimum_participants)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
