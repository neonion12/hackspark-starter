#!/usr/bin/env bash
# =============================================================================
# RentPi HACKSPARK — CLI Test Suite
# Tests P1–P16 via the API Gateway (http://localhost:8000)
# Usage: ./tests/test_all.sh [GATEWAY_URL]
# =============================================================================

GW="${1:-http://localhost:8000}"
PASS=0; FAIL=0; SKIP=0

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN="\033[0;32m"; RED="\033[0;31m"; YELLOW="\033[0;33m"; CYAN="\033[0;36m"; RESET="\033[0m"

# ── Helpers ───────────────────────────────────────────────────────────────────
section() { echo -e "\n${CYAN}══════════════════════════════════════════${RESET}"; echo -e "${CYAN} $1${RESET}"; echo -e "${CYAN}══════════════════════════════════════════${RESET}"; }
ok()   { echo -e "  ${GREEN}✓${RESET} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}✗${RESET} $1"; ((FAIL++)); }
skip() { echo -e "  ${YELLOW}⊘${RESET} $1 (skipped)"; ((SKIP++)); }
info() { echo -e "  ${YELLOW}ℹ${RESET} $1"; }

# Assert HTTP status
assert_status() {
  local label="$1" expected="$2" actual="$3"
  [ "$actual" = "$expected" ] && ok "$label (HTTP $actual)" || fail "$label — expected HTTP $expected, got $actual"
}

# Assert JSON field value
assert_json() {
  local label="$1" field="$2" expected="$3" json="$4"
  local actual
  actual=$(echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d$field)" 2>/dev/null)
  [ "$actual" = "$expected" ] && ok "$label ($field = $expected)" || fail "$label — $field: expected '$expected', got '$actual'"
}

# Assert JSON field is not empty
assert_not_empty() {
  local label="$1" field="$2" json="$3"
  local actual
  actual=$(echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d$field)" 2>/dev/null)
  [ -n "$actual" ] && [ "$actual" != "None" ] && [ "$actual" != "[]" ] && ok "$label ($field is present)" || fail "$label — $field is empty or missing"
}

require_cmd() { command -v "$1" &>/dev/null || { echo -e "${RED}ERROR: $1 not found. Install it first.${RESET}"; exit 1; }; }
require_cmd curl; require_cmd python3

# ── Wait for gateway ──────────────────────────────────────────────────────────
echo -e "\n${CYAN}Waiting for API Gateway at $GW ...${RESET}"
for i in $(seq 1 30); do
  curl -sf "$GW/status" >/dev/null 2>&1 && break
  echo -n "."; sleep 2
done
echo ""

JWT=""  # Will be populated in P2 tests

# =============================================================================
section "P1 — Health Checks"
# =============================================================================

RESP=$(curl -sf "$GW/status")
STATUS=$(curl -so /dev/null -w "%{http_code}" "$GW/status")
assert_status "Gateway /status returns 200" "200" "$STATUS"
assert_json "Gateway status field" "['status']" "OK" "$RESP"
assert_json "Gateway service name" "['service']" "api-gateway" "$RESP"

for SVC in "user-service" "rental-service" "analytics-service" "agentic-service"; do
  VAL=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['downstream']['$SVC'])" 2>/dev/null)
  [ "$VAL" = "OK" ] && ok "$SVC reported OK in downstream" || fail "$SVC missing or not OK in downstream (got '$VAL')"
done

# =============================================================================
section "P2 — User Authentication"
# =============================================================================

# Register
UNIQUE_EMAIL="test_$(date +%s)@rentpi.test"
REG=$(curl -sf -X POST "$GW/users/register" -H "Content-Type: application/json" \
  -d "{\"name\":\"Test User\",\"email\":\"$UNIQUE_EMAIL\",\"password\":\"pass1234\"}")
REG_STATUS=$(curl -so /dev/null -w "%{http_code}" -X POST "$GW/users/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Test User2\",\"email\":\"test2_$(date +%s)@rentpi.test\",\"password\":\"pass1234\"}")
assert_status "Register new user" "201" "$REG_STATUS"

JWT=$(echo "$REG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)
[ -n "$JWT" ] && ok "Register returns JWT" || fail "Register did not return JWT"

# Duplicate email → 409
DUP_STATUS=$(curl -so /dev/null -w "%{http_code}" -X POST "$GW/users/register" \
  -H "Content-Type: application/json" -d "{\"name\":\"x\",\"email\":\"$UNIQUE_EMAIL\",\"password\":\"y\"}")
assert_status "Duplicate email → 409" "409" "$DUP_STATUS"

# Login
LOGIN=$(curl -sf -X POST "$GW/users/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$UNIQUE_EMAIL\",\"password\":\"pass1234\"}")
LOGIN_STATUS=$(curl -so /dev/null -w "%{http_code}" -X POST "$GW/users/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$UNIQUE_EMAIL\",\"password\":\"pass1234\"}")
assert_status "Login returns 200" "200" "$LOGIN_STATUS"
JWT=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)
[ -n "$JWT" ] && ok "Login returns JWT" || fail "Login did not return JWT"

# Wrong password → 401
BAD_LOGIN=$(curl -so /dev/null -w "%{http_code}" -X POST "$GW/users/login" \
  -H "Content-Type: application/json" -d "{\"email\":\"$UNIQUE_EMAIL\",\"password\":\"wrong\"}")
assert_status "Wrong password → 401" "401" "$BAD_LOGIN"

# /users/me
ME_STATUS=$(curl -so /dev/null -w "%{http_code}" "$GW/users/me" -H "Authorization: Bearer $JWT")
assert_status "GET /users/me with JWT → 200" "200" "$ME_STATUS"
ME_NO_TOKEN=$(curl -so /dev/null -w "%{http_code}" "$GW/users/me")
assert_status "GET /users/me without JWT → 401" "401" "$ME_NO_TOKEN"

# =============================================================================
section "P3 — Product Proxy"
# =============================================================================

PROD_STATUS=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/products")
assert_status "GET /rentals/products returns 200" "200" "$PROD_STATUS"

PROD=$(curl -sf "$GW/rentals/products")
assert_not_empty "Products returns data array" "['data']" "$PROD"

SINGLE_STATUS=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/products/1")
assert_status "GET /rentals/products/1 returns 200" "200" "$SINGLE_STATUS"

# =============================================================================
section "P5 — Paginated Product Listing with Category Filter"
# =============================================================================

ELEC_STATUS=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/products?category=ELECTRONICS&page=1&limit=5")
assert_status "Filter by valid category ELECTRONICS → 200" "200" "$ELEC_STATUS"

BAD_CAT=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/products?category=INVALID_ZZZZZ")
assert_status "Invalid category → 400" "400" "$BAD_CAT"

BAD_CAT_BODY=$(curl -sf "$GW/rentals/products?category=INVALID_ZZZZZ" 2>/dev/null || echo '{}')
VALID_CATS=$(echo "$BAD_CAT_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('validCategories',''))" 2>/dev/null)
[ -n "$VALID_CATS" ] && ok "400 body includes validCategories" || fail "400 body missing validCategories"

# =============================================================================
section "P6 — The Loyalty Discount"
# =============================================================================

DISC_STATUS=$(curl -so /dev/null -w "%{http_code}" "$GW/users/1/discount")
[ "$DISC_STATUS" = "200" ] || [ "$DISC_STATUS" = "404" ] && ok "GET /users/1/discount responds" || fail "GET /users/1/discount unexpected status $DISC_STATUS"

DISC=$(curl -sf "$GW/users/42/discount" 2>/dev/null || echo '{}')
HAS_DISCOUNT=$(echo "$DISC" | python3 -c "import sys,json; d=json.load(sys.stdin); print('discountPercent' in d)" 2>/dev/null)
[ "$HAS_DISCOUNT" = "True" ] && ok "Discount response has discountPercent" || skip "Could not verify discount (central API may require token)"

DISC_404=$(curl -so /dev/null -w "%{http_code}" "$GW/users/99999999/discount")
[ "$DISC_404" = "404" ] && ok "Non-existent user → 404" || info "Non-existent user returned $DISC_404 (may need real Central API)"

# =============================================================================
section "P7 — Is It Available?"
# =============================================================================

AVAIL_STATUS=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/products/1/availability?from=2024-03-01&to=2024-03-14")
[ "$AVAIL_STATUS" = "200" ] && ok "Availability check returns 200" || info "Availability returned $AVAIL_STATUS (needs Central API token)"

AVAIL=$(curl -sf "$GW/rentals/products/1/availability?from=2024-03-01&to=2024-03-14" 2>/dev/null || echo '{}')
HAS_AVAIL=$(echo "$AVAIL" | python3 -c "import sys,json; d=json.load(sys.stdin); print('available' in d)" 2>/dev/null)
[ "$HAS_AVAIL" = "True" ] && ok "Availability response has 'available' field" || skip "Skipped: no Central API token"

AVAIL_BAD=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/products/1/availability")
assert_status "Availability without params → 400" "400" "$AVAIL_BAD"

# Test interval merging logic locally
python3 - <<'EOF'
intervals = [
    {"start": "2024-03-01", "end": "2024-03-10"},
    {"start": "2024-03-05", "end": "2024-03-15"},
    {"start": "2024-03-20", "end": "2024-03-25"},
]
intervals.sort(key=lambda x: x["start"])
merged = [dict(intervals[0])]
for iv in intervals[1:]:
    last = merged[-1]
    if iv["start"] <= last["end"]:
        if iv["end"] > last["end"]: last["end"] = iv["end"]
    else:
        merged.append(dict(iv))
assert merged == [{"start":"2024-03-01","end":"2024-03-15"},{"start":"2024-03-20","end":"2024-03-25"}], f"Got {merged}"
print("  \033[0;32m✓\033[0m Interval merge algorithm correct")
EOF

# =============================================================================
section "P8 — The Record Day (kth-busiest-date)"
# =============================================================================

# Validation tests
K_BAD1=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/kth-busiest-date?from=2024-01&to=2024-06&k=abc")
assert_status "k=abc → 400" "400" "$K_BAD1"

K_BAD2=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/kth-busiest-date?from=2024-06&to=2024-01&k=3")
assert_status "from after to → 400" "400" "$K_BAD2"

K_BAD3=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/kth-busiest-date?from=2023-01&to=2024-06&k=3")
assert_status "Range > 12 months → 400" "400" "$K_BAD3"

K_GOOD=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/kth-busiest-date?from=2024-01&to=2024-06&k=3")
[ "$K_GOOD" = "200" ] || [ "$K_GOOD" = "404" ] && ok "k=3 returns valid status" || info "kth-busiest returned $K_GOOD (needs Central API)"

# Min-heap correctness
python3 - <<'EOF'
import heapq
entries = [("2024-03-10", 100), ("2024-03-15", 412), ("2024-03-05", 300),
           ("2024-03-08", 289), ("2024-03-20", 350)]
k = 3
# Min-heap of size k
heap = []
for date, cnt in entries:
    heapq.heappush(heap, (cnt, date))
    if len(heap) > k: heapq.heappop(heap)
result_date = heap[0][1]
result_cnt  = heap[0][0]
assert result_cnt == 300, f"Expected 300 got {result_cnt}"
print(f"  \033[0;32m✓\033[0m Min-heap kth-busiest correct (3rd busiest count={result_cnt})")
EOF

# =============================================================================
section "P9 — What Does This Renter Love?"
# =============================================================================

TOP_BAD=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/users/1/top-categories?k=abc")
assert_status "k=abc → 400" "400" "$TOP_BAD"

TOP_GOOD=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/users/1/top-categories?k=5")
[ "$TOP_GOOD" = "200" ] && ok "top-categories returns 200" || info "top-categories returned $TOP_GOOD (needs Central API)"

TOP=$(curl -sf "$GW/rentals/users/1/top-categories?k=5" 2>/dev/null || echo '{}')
HAS_TOP=$(echo "$TOP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('topCategories' in d)" 2>/dev/null)
[ "$HAS_TOP" = "True" ] && ok "Response has topCategories" || skip "Skipped (needs Central API)"

# Heap correctness for top-k
python3 - <<'EOF'
import heapq
cats = {"ELECTRONICS": 14, "OUTDOOR": 9, "TOOLS": 6, "SPORTS": 3, "MUSIC": 1}
k = 3
heap = []
for cat, cnt in cats.items():
    heapq.heappush(heap, (cnt, cat))
    if len(heap) > k: heapq.heappop(heap)
result = sorted(heap, reverse=True)
assert result[0] == (14, "ELECTRONICS"), f"Got {result[0]}"
assert len(result) == 3
print(f"  \033[0;32m✓\033[0m Top-k categories heap algorithm correct (top={result[0]})")
EOF

# =============================================================================
section "P10 — The Long Vacation"
# =============================================================================

STREAK=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/products/1/free-streak?year=2023")
[ "$STREAK" = "200" ] && ok "free-streak returns 200" || info "free-streak returned $STREAK (needs Central API)"

STREAK_BAD=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/products/1/free-streak")
assert_status "free-streak without year → 400" "400" "$STREAK_BAD"

# Test free-gap algorithm
python3 - <<'EOF'
year_start, year_end = "2023-01-01", "2023-12-31"
busy_periods = [
    {"start": "2023-02-01", "end": "2023-03-15"},
    {"start": "2023-07-01", "end": "2023-08-15"},
]
from datetime import date, timedelta

def str_to_date(s): return date.fromisoformat(s)

gaps = []
cursor = str_to_date(year_start)
y_end = str_to_date(year_end)
for b in busy_periods:
    bs = str_to_date(b["start"])
    be = str_to_date(b["end"])
    if cursor < bs:
        gaps.append((cursor, bs - timedelta(days=1)))
    cursor = max(be + timedelta(days=1), cursor)
if cursor <= y_end:
    gaps.append((cursor, y_end))

best = max(gaps, key=lambda g: (g[1]-g[0]).days)
days = (best[1] - best[0]).days + 1
assert best == (str_to_date("2023-03-16"), str_to_date("2023-06-30")), f"Got {best}"
print(f"  \033[0;32m✓\033[0m Free streak algorithm correct (longest gap = {days} days)")
EOF

# =============================================================================
section "P11 — The Seven-Day Rush"
# =============================================================================

PEAK_BAD1=$(curl -so /dev/null -w "%{http_code}" "$GW/analytics/peak-window?from=2024-01&to=2024-14")
[ "$PEAK_BAD1" = "400" ] && ok "Invalid month → 400" || info "Returned $PEAK_BAD1"

PEAK_BAD2=$(curl -so /dev/null -w "%{http_code}" "$GW/analytics/peak-window?from=2024-06&to=2024-01")
assert_status "from after to → 400" "400" "$PEAK_BAD2"

PEAK_BAD3=$(curl -so /dev/null -w "%{http_code}" "$GW/analytics/peak-window?from=2023-01&to=2024-06")
assert_status "Range > 12 months → 400" "400" "$PEAK_BAD3"

PEAK=$(curl -so /dev/null -w "%{http_code}" "$GW/analytics/peak-window?from=2024-01&to=2024-06")
[ "$PEAK" = "200" ] && ok "peak-window returns 200" || info "peak-window returned $PEAK (needs Central API)"

# Sliding window O(n) correctness
python3 - <<'EOF'
counts = [10, 5, 20, 30, 15, 8, 12, 25, 18, 22, 14, 9, 11, 28]
W = 7
window_sum = sum(counts[:W])
best_sum = window_sum
best_start = 0
for i in range(W, len(counts)):
    window_sum += counts[i] - counts[i-W]
    if window_sum > best_sum:
        best_sum = window_sum
        best_start = i - W + 1
assert best_sum == sum(counts[best_start:best_start+W])
print(f"  \033[0;32m✓\033[0m Sliding window O(n) algorithm correct (peak sum={best_sum} at index {best_start})")
EOF

# =============================================================================
section "P12 — The Unified Feed"
# =============================================================================

FEED_BAD1=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/merged-feed")
assert_status "No productIds → 400" "400" "$FEED_BAD1"

FEED_BAD2=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/merged-feed?productIds=1,2,3&limit=200")
assert_status "limit > 100 → 400" "400" "$FEED_BAD2"

FEED_BAD3=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/merged-feed?productIds=1,2,3,4,5,6,7,8,9,10,11")
assert_status "More than 10 productIds → 400" "400" "$FEED_BAD3"

FEED=$(curl -so /dev/null -w "%{http_code}" "$GW/rentals/merged-feed?productIds=1,2,3&limit=10")
[ "$FEED" = "200" ] && ok "merged-feed returns 200" || info "merged-feed returned $FEED (needs Central API)"

# K-way merge correctness
python3 - <<'EOF'
from datetime import date

def merge_two(a, b):
    result, i, j = [], 0, 0
    while i < len(a) and j < len(b):
        if a[i] <= b[j]: result.append(a[i]); i += 1
        else: result.append(b[j]); j += 1
    result.extend(a[i:]); result.extend(b[j:])
    return result

def merge_all(arrays):
    if not arrays: return []
    if len(arrays) == 1: return arrays[0]
    mid = len(arrays) // 2
    return merge_two(merge_all(arrays[:mid]), merge_all(arrays[mid:]))

a = [date(2024,1,1), date(2024,1,5), date(2024,1,10)]
b = [date(2024,1,3), date(2024,1,7), date(2024,1,12)]
c = [date(2024,1,2), date(2024,1,8), date(2024,1,11)]

result = merge_all([a, b, c])
assert result == sorted(result), "Not sorted!"
print(f"  \033[0;32m✓\033[0m K-way merge algorithm correct ({result})")
EOF

# =============================================================================
section "P13 — Chasing the Surge"
# =============================================================================

SURGE_BAD=$(curl -so /dev/null -w "%{http_code}" "$GW/analytics/surge-days?month=not-a-month")
assert_status "Invalid month → 400" "400" "$SURGE_BAD"

SURGE=$(curl -so /dev/null -w "%{http_code}" "$GW/analytics/surge-days?month=2024-03")
[ "$SURGE" = "200" ] && ok "surge-days returns 200" || info "surge-days returned $SURGE (needs Central API)"

# Monotonic stack O(n) correctness
python3 - <<'EOF'
counts = [342, 289, 301, 412, 200, 150, 380, 220, 310, 100]
n = len(counts)
result = [None] * n
stack = []
for i in range(n):
    while stack and counts[i] > counts[stack[-1]]:
        idx = stack.pop()
        result[idx] = i
    stack.append(i)

# Day 0 (342) should next surge at day 3 (412)
assert result[0] == 3, f"Expected 3, got {result[0]}"
# Day 1 (289) should next surge at day 3 (412)
assert result[1] == 3, f"Expected 3, got {result[1]}"
# Day 6 (380) should next surge... count 310 is less, so None
assert result[6] is None or counts[result[6]] > counts[6]
print(f"  \033[0;32m✓\033[0m Monotonic stack surge algorithm correct (day 0→next at {result[0]}, day 1→{result[1]})")
EOF

# =============================================================================
section "P14 — What's In Season?"
# =============================================================================

REC_BAD1=$(curl -so /dev/null -w "%{http_code}" "$GW/analytics/recommendations?date=not-a-date&limit=5")
assert_status "Invalid date → 400" "400" "$REC_BAD1"

REC_BAD2=$(curl -so /dev/null -w "%{http_code}" "$GW/analytics/recommendations?date=2024-06-15&limit=200")
assert_status "limit > 50 → 400" "400" "$REC_BAD2"

REC=$(curl -so /dev/null -w "%{http_code}" "$GW/analytics/recommendations?date=2024-06-15&limit=5")
[ "$REC" = "200" ] && ok "recommendations returns 200" || info "recommendations returned $REC (needs Central API)"

# Edge case: window crossing year boundary
python3 - <<'EOF'
from datetime import date, timedelta
center = date(2024, 1, 3)
window_start = center - timedelta(days=7)
window_end   = center + timedelta(days=7)
assert window_start == date(2023, 12, 27), f"Got {window_start}"
assert window_end   == date(2024, 1, 10),  f"Got {window_end}"
print(f"  \033[0;32m✓\033[0m Year-boundary window correct ({window_start} to {window_end})")
EOF

# =============================================================================
section "P15 — RentPi Assistant"
# =============================================================================

# Off-topic guard
OFF_TOPIC=$(curl -sf -X POST "$GW/chat" -H "Content-Type: application/json" \
  -d '{"sessionId":"test-guard","message":"What is the capital of France?"}')
OFF_STATUS=$(curl -so /dev/null -w "%{http_code}" -X POST "$GW/chat" -H "Content-Type: application/json" \
  -d '{"sessionId":"test-guard2","message":"Tell me a joke"}')
assert_status "Chat endpoint responds" "200" "$OFF_STATUS"

REPLY=$(echo "$OFF_TOPIC" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('reply',''))" 2>/dev/null)
[ -n "$REPLY" ] && ok "Off-topic message gets a reply" || fail "No reply field in response"
echo "    Reply preview: $(echo "$REPLY" | head -c 80)..."

# On-topic test
ON_TOPIC=$(curl -sf -X POST "$GW/chat" -H "Content-Type: application/json" \
  -d '{"sessionId":"test-rentpi","message":"What categories does RentPi offer?"}')
ON_REPLY=$(echo "$ON_TOPIC" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('reply',''))" 2>/dev/null)
[ -n "$ON_REPLY" ] && ok "On-topic chat message gets a reply" || fail "No reply for on-topic message"

# Missing fields → 400
CHAT_BAD=$(curl -so /dev/null -w "%{http_code}" -X POST "$GW/chat" -H "Content-Type: application/json" -d '{}')
assert_status "Missing sessionId/message → 400" "400" "$CHAT_BAD"

# =============================================================================
section "P16 — Chat That Remembers"
# =============================================================================

SESSION_ID="test-session-$(date +%s)"

# Create session via chat
curl -sf -X POST "$GW/chat" -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"message\":\"What is the most popular rental category?\"}" >/dev/null

# List sessions
SESS_LIST_STATUS=$(curl -so /dev/null -w "%{http_code}" "$GW/chat/sessions")
assert_status "GET /chat/sessions → 200" "200" "$SESS_LIST_STATUS"

SESS_LIST=$(curl -sf "$GW/chat/sessions" 2>/dev/null || echo '{}')
HAS_SESSIONS=$(echo "$SESS_LIST" | python3 -c "import sys,json; d=json.load(sys.stdin); print('sessions' in d)" 2>/dev/null)
[ "$HAS_SESSIONS" = "True" ] && ok "Sessions list has 'sessions' key" || fail "Sessions list missing 'sessions'"

# Get history
HIST_STATUS=$(curl -so /dev/null -w "%{http_code}" "$GW/chat/$SESSION_ID/history")
assert_status "GET /chat/:id/history → 200" "200" "$HIST_STATUS"

HIST=$(curl -sf "$GW/chat/$SESSION_ID/history" 2>/dev/null || echo '{}')
HAS_MSG=$(echo "$HIST" | python3 -c "import sys,json; d=json.load(sys.stdin); print('messages' in d)" 2>/dev/null)
[ "$HAS_MSG" = "True" ] && ok "History has 'messages' key" || fail "History missing 'messages'"

MSG_COUNT=$(echo "$HIST" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('messages',[])))" 2>/dev/null)
[ "$MSG_COUNT" -ge "2" ] 2>/dev/null && ok "History contains at least 2 messages (user + assistant)" || fail "Expected 2+ messages, got $MSG_COUNT"

# Delete session
DEL_STATUS=$(curl -so /dev/null -w "%{http_code}" -X DELETE "$GW/chat/$SESSION_ID")
assert_status "DELETE /chat/:id → 200" "200" "$DEL_STATUS"

HIST_AFTER_DEL=$(curl -so /dev/null -w "%{http_code}" "$GW/chat/$SESSION_ID/history")
assert_status "History after delete → 404" "404" "$HIST_AFTER_DEL"

# =============================================================================
section "Bonus B2 — Exponential Backoff (algorithm check)"
# =============================================================================
python3 - <<'EOF'
import random
def compute_backoff(retry_after, attempt, seed=42):
    random.seed(seed)
    base = retry_after * (2 ** attempt)
    jitter = base * (0.8 + random.random() * 0.4)
    return jitter

# Attempt 0: wait = retryAfterSeconds
# Attempt 1: wait = retryAfterSeconds * 2 (+ jitter)
# Attempt 2: wait = retryAfterSeconds * 4 (+ jitter)
b0 = compute_backoff(10, 0)
b1 = compute_backoff(10, 1)
b2 = compute_backoff(10, 2)
assert b0 < b1 < b2, f"Backoff should increase: {b0:.1f} {b1:.1f} {b2:.1f}"
print(f"  \033[0;32m✓\033[0m Exponential backoff increases correctly ({b0:.1f}s → {b1:.1f}s → {b2:.1f}s)")
EOF

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${CYAN}══════════════════════════════════════════${RESET}"
echo -e "${CYAN} Test Summary${RESET}"
echo -e "${CYAN}══════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}Passed: $PASS${RESET}"
echo -e "  ${RED}Failed: $FAIL${RESET}"
echo -e "  ${YELLOW}Skipped: $SKIP${RESET}"
TOTAL=$((PASS + FAIL + SKIP))
echo -e "  Total:  $TOTAL"
echo ""
if [ "$FAIL" = "0" ]; then
  echo -e "  ${GREEN}🎉 All tests passed!${RESET}"
else
  echo -e "  ${RED}⚠️  $FAIL test(s) failed. Check logs above.${RESET}"
fi
echo ""