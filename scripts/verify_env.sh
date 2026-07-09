#!/usr/bin/env bash
# FAIV Predict — environment verification.
# Reads frontend/.env.local and ml-service/.env and checks every credential
# against the live services. Run from the repo root:
#   bash scripts/verify_env.sh [login-email] [login-password]
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_ENV="$ROOT/frontend/.env.local"
ML_ENV="$ROOT/ml-service/.env"

pass() { printf "  \033[32mPASS\033[0m %s\n" "$1"; }
fail() { printf "  \033[31mFAIL\033[0m %s\n" "$1"; FAILURES=$((FAILURES + 1)); }
warn() { printf "  \033[33mWARN\033[0m %s\n" "$1"; }
FAILURES=0

getvar() { # getvar FILE KEY
  grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}

SUPABASE_URL="$(getvar "$FRONTEND_ENV" NEXT_PUBLIC_SUPABASE_URL)"
ANON_KEY="$(getvar "$FRONTEND_ENV" NEXT_PUBLIC_SUPABASE_ANON_KEY)"
LLM_KEY="$(getvar "$FRONTEND_ENV" LLM_API_KEY)"
DB_URL="$(getvar "$ML_ENV" DATABASE_URL)"
SERVICE_KEY="$(getvar "$ML_ENV" SUPABASE_KEY)"

LOGIN_EMAIL="${1:-}"
LOGIN_PASSWORD="${2:-}"

echo "== 1. Supabase project reachability + anon key =="
if [ -z "$SUPABASE_URL" ] || [ -z "$ANON_KEY" ]; then
  fail "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing from frontend/.env.local"
else
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$SUPABASE_URL/auth/v1/health" -H "apikey: $ANON_KEY")
  [ "$code" = "200" ] && pass "auth service reachable ($code)" || fail "auth health returned HTTP $code"

  body=$(curl -s --max-time 15 "$SUPABASE_URL/rest/v1/brands?select=id&limit=1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY")
  case "$body" in
    \[*) pass "anon key can read the brands table" ;;
    *)   fail "brands read failed: $(echo "$body" | head -c 160)" ;;
  esac
fi

echo "== 2. Auth login =="
if [ -z "$LOGIN_EMAIL" ] || [ -z "$LOGIN_PASSWORD" ]; then
  warn "no login email/password passed as arguments — skipping the auth login check"
else
  resp=$(curl -s --max-time 15 -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$LOGIN_EMAIL\",\"password\":\"$LOGIN_PASSWORD\"}")
  if echo "$resp" | grep -q '"access_token"'; then
    pass "signInWithPassword succeeds for $LOGIN_EMAIL"
  else
    fail "login failed: $(echo "$resp" | head -c 200)"
  fi
fi

echo "== 3. DATABASE_URL (Postgres DSN for the ML service) =="
if [ -z "$DB_URL" ]; then
  fail "DATABASE_URL missing from ml-service/.env"
elif [ -x "$ROOT/ml-service/venv/bin/python" ]; then
  "$ROOT/ml-service/venv/bin/python" - "$DB_URL" <<'PY'
import sys, psycopg2
try:
    conn = psycopg2.connect(sys.argv[1], connect_timeout=15)
    with conn.cursor() as cur:
        for table in ("brands", "posts", "predictions", "models"):
            cur.execute(f"SELECT count(*) FROM {table}")
            print(f"  PASS {table}: {cur.fetchone()[0]} rows")
    conn.close()
except Exception as e:
    print(f"  FAIL database connection: {e}")
    sys.exit(1)
PY
  [ $? -ne 0 ] && FAILURES=$((FAILURES + 1))
else
  warn "ml-service/venv not found — create it first (python3 -m venv venv && pip install -r requirements.txt)"
fi

echo "== 4. SUPABASE_KEY (service key → Storage 'models' bucket) =="
if [ -z "$SERVICE_KEY" ]; then
  fail "SUPABASE_KEY missing from ml-service/.env"
else
  resp=$(curl -s --max-time 15 -X POST "$SUPABASE_URL/storage/v1/object/list/models" \
    -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" \
    -d '{"prefix":"","limit":5}')
  case "$resp" in
    \[*) pass "service key can list the 'models' storage bucket ($(echo "$resp" | grep -o '"name"' | wc -l | tr -d ' ') objects shown)" ;;
    *)   fail "storage list failed: $(echo "$resp" | head -c 160)" ;;
  esac
fi

echo "== 5. LLM_API_KEY (Gemini via generativelanguage.googleapis.com) =="
if [ -z "$LLM_KEY" ]; then
  warn "LLM_API_KEY not set — AI classify/refine will report 501 (optional feature)"
else
  code=$(curl -s -o /tmp/gemini_check.json -w "%{http_code}" --max-time 20 \
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$LLM_KEY" \
    -H "Content-Type: application/json" \
    -d '{"contents":[{"parts":[{"text":"Reply with the single word: ok"}]}]}')
  if [ "$code" = "200" ]; then
    pass "Gemini API accepted the key"
  else
    fail "Gemini API returned HTTP $code: $(head -c 160 /tmp/gemini_check.json)"
  fi
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "All checks passed."
else
  echo "$FAILURES check(s) failed."
  exit 1
fi
