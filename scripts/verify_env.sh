#!/usr/bin/env bash
# FAIV Predict — local environment verification (read-only).
# Login credentials are accepted only through environment variables so they do
# not appear in shell history or process arguments:
#   VERIFY_LOGIN_EMAIL=... VERIFY_LOGIN_PASSWORD=... bash scripts/verify_env.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_ENV="$ROOT/.env"
FRONTEND_ENV="$ROOT/frontend/.env.local"
ML_ENV="$ROOT/ml-service/.env"

pass() { printf "  \033[32mPASS\033[0m %s\n" "$1"; }
fail() { printf "  \033[31mFAIL\033[0m %s\n" "$1"; FAILURES=$((FAILURES + 1)); }
warn() { printf "  \033[33mWARN\033[0m %s\n" "$1"; }
FAILURES=0

getvar() {
  grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}

getraw() {
  grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2-
}

SUPABASE_URL="$(getvar "$FRONTEND_ENV" NEXT_PUBLIC_SUPABASE_URL)"
ANON_KEY="$(getvar "$FRONTEND_ENV" NEXT_PUBLIC_SUPABASE_ANON_KEY)"
LLM_KEY="$(getvar "$FRONTEND_ENV" LLM_API_KEY)"
DB_URL="$(getvar "$ML_ENV" DATABASE_URL)"
SERVICE_KEY="$(getvar "$ML_ENV" SUPABASE_KEY)"
IG_BRANDS_JSON="$(getraw "$ML_ENV" IG_BRANDS_JSON)"
IG_SYNC_POST_LIMIT="$(getvar "$ML_ENV" IG_SYNC_POST_LIMIT)"
LOGIN_EMAIL="${VERIFY_LOGIN_EMAIL:-}"
LOGIN_PASSWORD="${VERIFY_LOGIN_PASSWORD:-}"
ML_PYTHON="${ML_PYTHON:-}"

# Docker Compose uses the repository-root .env. Native development may use the
# service-specific files, so accept either without printing any value.
if [ -f "$ROOT_ENV" ]; then
  [ -n "$SUPABASE_URL" ] || SUPABASE_URL="$(getvar "$ROOT_ENV" NEXT_PUBLIC_SUPABASE_URL)"
  [ -n "$ANON_KEY" ] || ANON_KEY="$(getvar "$ROOT_ENV" NEXT_PUBLIC_SUPABASE_ANON_KEY)"
  [ -n "$LLM_KEY" ] || LLM_KEY="$(getvar "$ROOT_ENV" LLM_API_KEY)"
  [ -n "$DB_URL" ] || DB_URL="$(getvar "$ROOT_ENV" DATABASE_URL)"
  [ -n "$SERVICE_KEY" ] || SERVICE_KEY="$(getvar "$ROOT_ENV" SUPABASE_KEY)"
  [ -n "$IG_BRANDS_JSON" ] || IG_BRANDS_JSON="$(getraw "$ROOT_ENV" IG_BRANDS_JSON)"
  [ -n "$IG_SYNC_POST_LIMIT" ] || IG_SYNC_POST_LIMIT="$(getvar "$ROOT_ENV" IG_SYNC_POST_LIMIT)"
fi

IG_SYNC_POST_LIMIT="${IG_SYNC_POST_LIMIT:-500}"

if [ -z "$ML_PYTHON" ]; then
  if [ -x "$ROOT/ml-service/venv/bin/python" ]; then
    ML_PYTHON="$ROOT/ml-service/venv/bin/python"
  elif [ -x "$ROOT/ml-service/venv/Scripts/python.exe" ]; then
    ML_PYTHON="$ROOT/ml-service/venv/Scripts/python.exe"
  elif command -v python3 >/dev/null 2>&1 && python3 -c "import psycopg2" >/dev/null 2>&1; then
    ML_PYTHON="python3"
  fi
fi

echo "== 1. Supabase project reachability + anon key =="
if [ -z "$SUPABASE_URL" ] || [ -z "$ANON_KEY" ]; then
  fail "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing from frontend/.env.local"
else
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$SUPABASE_URL/auth/v1/health" \
    -K /dev/fd/3 3<<< "header = \"apikey: $ANON_KEY\"")
  [ "$code" = "200" ] && pass "auth service reachable ($code)" || fail "auth health returned HTTP $code"

  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$SUPABASE_URL/rest/v1/brands?select=id&limit=1" \
    -K /dev/fd/3 3<<< $'header = "apikey: '"$ANON_KEY"$'"\nheader = "Authorization: Bearer '"$ANON_KEY"$'"')
  [ "$code" = "200" ] && pass "brands REST endpoint reachable (RLS controls returned rows)" || fail "brands endpoint returned HTTP $code"
fi

echo "== 2. Auth login =="
if [ -z "$LOGIN_EMAIL" ] || [ -z "$LOGIN_PASSWORD" ]; then
  warn "VERIFY_LOGIN_EMAIL / VERIFY_LOGIN_PASSWORD not set — skipping login check"
else
  payload=$(VERIFY_LOGIN_EMAIL="$LOGIN_EMAIL" VERIFY_LOGIN_PASSWORD="$LOGIN_PASSWORD" python3 - <<'PY'
import json, os
print(json.dumps({"email": os.environ["VERIFY_LOGIN_EMAIL"], "password": os.environ["VERIFY_LOGIN_PASSWORD"]}))
PY
  )
  resp=$(curl -s --max-time 15 -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -K /dev/fd/3 --data-binary @- \
    3<<< $'header = "apikey: '"$ANON_KEY"$'"\nheader = "Content-Type: application/json"' \
    <<< "$payload")
  unset payload
  if echo "$resp" | grep -q '"access_token"'; then
    pass "signInWithPassword succeeds"
  else
    fail "login failed (response redacted)"
  fi
fi

echo "== 3. DATABASE_URL + required schema =="
if [ -n "$SUPABASE_URL" ] && [ -n "$SERVICE_KEY" ]; then
  schema_ok=1
  for endpoint in \
    "brands?select=id,owner_id,instagram_account_id,profile_summary,timezone&limit=1" \
    "posts?select=id,instagram_media_id,source,synced_at,media_product_type&limit=1" \
    "predictions?select=id,created_by,actual_er,actual_source,realized_class,realized_class_basis,prediction_status,time_known,model_id,feature_schema_version,input_hash,deleted_at&limit=1" \
    "calendar_entries?select=id,owner_id,source,prediction_id&limit=1" \
    "prediction_publications?select=id,owner_id,brand_id,prediction_id,post_id,instagram_media_id,link_method,outcome_observed_at&limit=1" \
    "brand_trend_notes?select=id,brand_id,note,source,observed_at,tag,created_by,created_at&limit=1" \
    "content_lifecycle_events?select=id,owner_id,event_type,occurred_at&limit=1"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$SUPABASE_URL/rest/v1/$endpoint" \
      -K /dev/fd/3 \
      3<<< $'header = "apikey: '"$SERVICE_KEY"$'"\nheader = "Authorization: Bearer '"$SERVICE_KEY"$'"')
    [ "$code" = "200" ] || schema_ok=0
  done
  if [ "$schema_ok" = "1" ]; then
    pass "ownership, provenance, Meta product type, plan/publication cohesion, prediction lifecycle, and audit schema are exposed by PostgREST"
  else
    fail "required ownership, prediction-lifecycle, Meta product-type, or plan/publication-cohesion migration is missing or not exposed by PostgREST"
  fi
else
  warn "service key unavailable; skipping PostgREST schema preflight"
fi

if [ -z "$DB_URL" ]; then
  fail "DATABASE_URL missing from ml-service/.env"
elif [ -n "$ML_PYTHON" ]; then
  FAIV_VERIFY_DB_URL="$DB_URL" "$ML_PYTHON" - <<'PY'
import os, sys, psycopg2
try:
    conn = psycopg2.connect(os.environ["FAIV_VERIFY_DB_URL"], connect_timeout=15)
    with conn.cursor() as cur:
        for table in ("brands", "posts", "predictions", "models", "calendar_entries", "prediction_publications", "content_lifecycle_events", "brand_trend_notes"):
            cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
            if cur.fetchone()[0] is None:
                raise RuntimeError(f"missing table: {table}")
        for table, column in (
            ("brands", "owner_id"),
            ("brands", "instagram_account_id"),
            ("brands", "profile_summary"),
            ("brands", "timezone"),
            ("posts", "instagram_media_id"),
            ("posts", "source"),
            ("posts", "synced_at"),
            ("posts", "media_product_type"),
            ("predictions", "created_by"),
            ("predictions", "actual_er"),
            ("predictions", "actual_source"),
            ("predictions", "realized_class"),
            ("predictions", "realized_class_basis"),
            ("predictions", "prediction_status"),
            ("predictions", "time_known"),
            ("predictions", "model_id"),
            ("predictions", "feature_schema_version"),
            ("predictions", "input_hash"),
            ("predictions", "deleted_at"),
            ("prediction_publications", "owner_id"),
            ("prediction_publications", "brand_id"),
            ("prediction_publications", "prediction_id"),
            ("prediction_publications", "post_id"),
            ("prediction_publications", "instagram_media_id"),
            ("prediction_publications", "linked_by"),
            ("prediction_publications", "link_method"),
            ("prediction_publications", "outcome_observed_at"),
            ("brand_trend_notes", "brand_id"),
            ("brand_trend_notes", "note"),
            ("brand_trend_notes", "source"),
            ("brand_trend_notes", "observed_at"),
            ("brand_trend_notes", "created_by"),
        ):
            cur.execute(
                "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=%s AND column_name=%s",
                (table, column),
            )
            if cur.fetchone() is None:
                raise RuntimeError(f"missing column: {table}.{column}")
        for signature in (
            "public.link_prediction_publication(uuid,uuid)",
            "public.reconcile_prediction_publication_outcomes(uuid)",
            "public.validate_prediction_observed_outcome()",
        ):
            cur.execute("SELECT to_regprocedure(%s)", (signature,))
            if cur.fetchone()[0] is None:
                raise RuntimeError(f"missing function: {signature}")
        print("  PASS ownership, provenance, Meta product type, plan/publication cohesion, prediction lifecycle, and audit migrations are present")
    conn.close()
except Exception as exc:
    print(f"  FAIL database/schema check: {exc}")
    sys.exit(1)
PY
  [ $? -ne 0 ] && FAILURES=$((FAILURES + 1))
else
  warn "A Python runtime with psycopg2 was not found; set ML_PYTHON to run database checks"
fi

echo "== 4. Instagram credential bindings =="
if [[ "$IG_SYNC_POST_LIMIT" =~ ^[0-9]+$ ]] \
  && [ "$IG_SYNC_POST_LIMIT" -ge 1 ] \
  && [ "$IG_SYNC_POST_LIMIT" -le 1000 ]; then
  pass "IG_SYNC_POST_LIMIT is within the supported 1-1000 range"
else
  fail "IG_SYNC_POST_LIMIT must be an integer between 1 and 1000"
fi

if [ -z "$IG_BRANDS_JSON" ]; then
  warn "IG_BRANDS_JSON is not set — Insights/sync remain disconnected"
  if grep -Eq '^[A-Z0-9_]+_(INSTAGRAM_ID|PAGE_ACCESS_TOKEN)=' "$ML_ENV" 2>/dev/null; then
    warn "legacy account-specific Instagram variables are ignored; migrate them to brand_id-bound IG_BRANDS_JSON"
  fi
else
  if FAIV_VERIFY_IG_JSON="$IG_BRANDS_JSON" python3 - <<'PY'
import json, os, uuid
try:
    entries = json.loads(os.environ["FAIV_VERIFY_IG_JSON"])
    if not isinstance(entries, list) or not entries:
        raise ValueError("expected a non-empty array")
    seen = set()
    for entry in entries:
        brand_id = str(entry["brand_id"])
        uuid.UUID(brand_id)
        if brand_id in seen or not str(entry["instagram_id"]).strip() or not str(entry["access_token"]).strip():
            raise ValueError("duplicate or incomplete binding")
        seen.add(brand_id)
    print(f"  PASS {len(entries)} explicit Instagram brand binding(s) are structurally valid")
except Exception as exc:
    print(f"  FAIL IG_BRANDS_JSON is invalid: {exc}")
    raise SystemExit(1)
PY
  then
    :
  else
    FAILURES=$((FAILURES + 1))
  fi
fi

echo "== 5. SUPABASE_KEY (model Storage) =="
if [ -z "$SERVICE_KEY" ]; then
  fail "SUPABASE_KEY missing from ml-service/.env"
else
  resp=$(curl -s --max-time 15 -X POST "$SUPABASE_URL/storage/v1/object/list/models" \
    -K /dev/fd/3 --data-binary @- \
    3<<< $'header = "apikey: '"$SERVICE_KEY"$'"\nheader = "Authorization: Bearer '"$SERVICE_KEY"$'"\nheader = "Content-Type: application/json"' \
    <<< '{"prefix":"","limit":1}')
  case "$resp" in
    \[*) pass "service key can list the models bucket" ;;
    *) fail "models bucket check failed (response redacted)" ;;
  esac
fi

echo "== 6. Optional Gemini key =="
if [ -z "$LLM_KEY" ]; then
  warn "LLM_API_KEY not set — optional AI helpers will report 501"
else
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 \
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" \
    -K /dev/fd/3 --data-binary @- \
    3<<< $'header = "x-goog-api-key: '"$LLM_KEY"$'"\nheader = "Content-Type: application/json"' \
    <<< '{"contents":[{"parts":[{"text":"Reply with the single word: ok"}]}]}')
  [ "$code" = "200" ] && pass "Gemini accepted the key" || fail "Gemini returned HTTP $code"
fi

echo "== 7. Repository-safe n8n template =="
if python3 - "$ROOT" <<'PY'
import json, pathlib, sys

root = pathlib.Path(sys.argv[1])
compose = (root / "docker-compose.yml").read_text(encoding="utf-8")
workflow_text = (root / "n8n" / "workflow_sync_retrain.json").read_text(encoding="utf-8")
workflow = json.loads(workflow_text)

try:
    n8n_block = compose.split("\n  n8n:\n", 1)[1].split("\nvolumes:\n", 1)[0]
except IndexError as exc:
    raise RuntimeError("could not locate n8n Compose service") from exc

if "N8N_BLOCK_ENV_ACCESS_IN_NODE=true" not in n8n_block:
    raise RuntimeError("n8n environment access is not blocked")
for forbidden in ("FAIV_ML_URL=", "INTERNAL_API_TOKEN=", "NOTIFICATION_FROM_EMAIL=", "NOTIFICATION_TO_EMAIL="):
    if forbidden in n8n_block:
        raise RuntimeError(f"forbidden n8n environment variable remains: {forbidden}")
if "$env" in workflow_text:
    raise RuntimeError("workflow template still reads $env")
if workflow.get("active") is not False:
    raise RuntimeError("workflow template must be inactive")
requests = [node for node in workflow.get("nodes", []) if node.get("type") == "n8n-nodes-base.httpRequest"]
if len(requests) != 2:
    raise RuntimeError("expected exactly two HTTP Request nodes")
for node in requests:
    parameters = node.get("parameters", {})
    if parameters.get("authentication") != "genericCredentialType" or parameters.get("genericAuthType") != "httpHeaderAuth":
        raise RuntimeError(f"{node.get('name')} does not require Header Auth credential")
print("  PASS Compose blocks $env and the inactive workflow requires encrypted Header Auth credentials")
PY
then
  :
else
  FAILURES=$((FAILURES + 1))
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "All checks passed."
else
  echo "$FAILURES check(s) failed."
  exit 1
fi
