#!/usr/bin/env bash
# FAIV Predict — local environment verification (read-only).
# Login credentials are accepted only through environment variables so they do
# not appear in shell history or process arguments:
#   VERIFY_LOGIN_EMAIL=... VERIFY_LOGIN_PASSWORD=... bash scripts/verify_env.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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
LOGIN_EMAIL="${VERIFY_LOGIN_EMAIL:-}"
LOGIN_PASSWORD="${VERIFY_LOGIN_PASSWORD:-}"

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
if [ -z "$DB_URL" ]; then
  fail "DATABASE_URL missing from ml-service/.env"
elif [ -x "$ROOT/ml-service/venv/bin/python" ]; then
  FAIV_VERIFY_DB_URL="$DB_URL" "$ROOT/ml-service/venv/bin/python" - <<'PY'
import os, sys, psycopg2
try:
    conn = psycopg2.connect(os.environ["FAIV_VERIFY_DB_URL"], connect_timeout=15)
    with conn.cursor() as cur:
        for table in ("brands", "posts", "predictions", "models", "calendar_entries"):
            cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
            if cur.fetchone()[0] is None:
                raise RuntimeError(f"missing table: {table}")
        for table, column in (
            ("brands", "owner_id"),
            ("posts", "instagram_media_id"),
            ("posts", "source"),
            ("posts", "synced_at"),
            ("predictions", "created_by"),
            ("predictions", "actual_source"),
        ):
            cur.execute(
                "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=%s AND column_name=%s",
                (table, column),
            )
            if cur.fetchone() is None:
                raise RuntimeError(f"missing column: {table}.{column}")
        print("  PASS ownership, calendar, and post-provenance migration is present")
    conn.close()
except Exception as exc:
    print(f"  FAIL database/schema check: {exc}")
    sys.exit(1)
PY
  [ $? -ne 0 ] && FAILURES=$((FAILURES + 1))
else
  warn "ml-service/venv not found — create it before running database checks"
fi

echo "== 4. Instagram credential bindings =="
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
    3<<< $'header = "Authorization: Bearer '"$SERVICE_KEY"$'"\nheader = "Content-Type: application/json"' \
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

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "All checks passed."
else
  echo "$FAILURES check(s) failed."
  exit 1
fi
