#!/usr/bin/env python3
"""Static, secret-free release contract for the bachelor-thesis repository."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    workflow_path = ROOT / "n8n" / "workflow_sync_retrain.json"
    workflow_text = workflow_path.read_text(encoding="utf-8")
    workflow = json.loads(workflow_text)
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    n8n_readme = (ROOT / "n8n" / "README.md").read_text(encoding="utf-8")
    env_example = (ROOT / ".env.example").read_text(encoding="utf-8")
    training_source = (ROOT / "ml-service" / "app" / "train_pipeline.py").read_text(encoding="utf-8")
    inference_source = (ROOT / "ml-service" / "app" / "main.py").read_text(encoding="utf-8")
    powershell_preflight = (ROOT / "scripts" / "thesis_preflight.ps1").read_text(encoding="utf-8")

    require(workflow.get("active") is False, "workflow template must import inactive")
    require("$env" not in workflow_text, "workflow template must not read $env")
    require("example.invalid" in workflow_text, "portable template needs safe email placeholders")
    require(
        not any(node.get("credentials") for node in workflow.get("nodes", [])),
        "portable workflow must not commit installation-specific credential IDs",
    )

    email_nodes = [
        node for node in workflow.get("nodes", [])
        if node.get("type") == "n8n-nodes-base.emailSend"
    ]
    require(len(email_nodes) == 3, "expected exactly three workflow email nodes")
    for node in email_nodes:
        parameters = node.get("parameters", {})
        require(
            parameters.get("emailFormat") == "html" and "emailType" not in parameters,
            f"{node.get('name')} must use the n8n v2 emailFormat schema",
        )

    stop_nodes = [
        node for node in workflow.get("nodes", [])
        if node.get("type") == "n8n-nodes-base.stopAndError"
    ]
    require(
        len(stop_nodes) == 2,
        "unhealthy and partial automation branches must fail their n8n execution",
    )
    connections = workflow.get("connections", {})
    require(
        "Fail Unhealthy Connection Execution"
        in json.dumps(connections.get("Send Connection Warning", {})),
        "health-warning branch must terminate with an error",
    )
    require(
        "Fail Partial Pipeline Execution"
        in json.dumps(connections.get("Send Failure Summary", {})),
        "partial sync/retrain branch must terminate with an error",
    )

    requests = [
        node for node in workflow.get("nodes", [])
        if node.get("type") == "n8n-nodes-base.httpRequest"
    ]
    require(len(requests) == 2, "expected exactly two workflow HTTP Request nodes")
    for node in requests:
        parameters = node.get("parameters", {})
        require(
            parameters.get("authentication") == "genericCredentialType"
            and parameters.get("genericAuthType") == "httpHeaderAuth",
            f"{node.get('name')} must require an encrypted Header Auth credential",
        )
        require(
            str(parameters.get("url", "")).startswith("http://ml-service:8000/"),
            f"{node.get('name')} must use the Docker-private ML URL",
        )

    n8n_service = compose.split("\n  n8n:\n", 1)[1].split("\nvolumes:\n", 1)[0]
    require(
        "N8N_BLOCK_ENV_ACCESS_IN_NODE=true" in n8n_service,
        "Compose must block workflow access to process environment variables",
    )
    require(
        "http://127.0.0.1:5678/healthz/readiness" in n8n_service,
        "n8n healthcheck must verify database readiness, not liveness only",
    )
    for forbidden in (
        "FAIV_ML_URL=",
        "INTERNAL_API_TOKEN=",
        "NOTIFICATION_FROM_EMAIL=",
        "NOTIFICATION_TO_EMAIL=",
    ):
        require(forbidden not in n8n_service, f"n8n service still receives {forbidden}")

    combined_docs = readme + "\n" + n8n_readme
    require(
        "n8n reads `FAIV_ML_URL`" not in combined_docs,
        "documentation still describes the retired environment-secret workflow",
    )
    require(
        "N8N_BLOCK_ENV_ACCESS_IN_NODE=false" not in combined_docs,
        "documentation still instructs operators to disable environment blocking",
    )
    for retired in (
        "FAIV_ML_URL=",
        "NOTIFICATION_FROM_EMAIL=",
        "NOTIFICATION_TO_EMAIL=",
    ):
        require(retired not in env_example, f".env.example still contains retired {retired}")

    for required_training_contract in (
        "MIN_POST_AGE_DAYS = 7",
        '"promotion_gate"',
        '"post_hour_support"',
        "ModelQualityError",
        '"runtime"',
    ):
        require(
            required_training_contract in training_source,
            f"training contract is missing {required_training_contract}",
        )
    require(
        '"empirical_training_distribution"' in inference_source,
        "optional-time inference must use empirical observed-hour support",
    )
    require(
        re.search(r"\$[A-Za-z_][A-Za-z0-9_]*:", powershell_preflight) is None,
        "PowerShell variables immediately followed by ':' must use ${Variable} syntax",
    )

    for required_path in (
        "docs/THESIS_TEST_REPORT.md",
        "docs/THESIS_DEMO_RUNBOOK.md",
        "docs/THESIS_ML_METHOD.md",
        "docs/DATA_PROVENANCE.md",
        "docs/PRODUCTION_READINESS.md",
    ):
        require((ROOT / required_path).is_file(), f"missing required document: {required_path}")

    print("PASS thesis repository contract: ML evidence, secure n8n template, docs, and demo artifacts are present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
