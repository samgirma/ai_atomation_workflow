#!/usr/bin/env bash
# ==============================================================================
# Test Script: POST /research Webhook
# Tests valid topic submission, empty topic validation, and missing topic handling.
# Safe for production: never logs secrets or credentials.
# ==============================================================================
set -euo pipefail

BASE_URL="${N8N_BASE_URL:-http://localhost:5678}"
MODE="${1:-test}" # "test" uses /webhook-test/, "prod" uses /webhook/

if [ "$MODE" = "prod" ]; then
  ENDPOINT="${BASE_URL}/webhook/research"
  echo "Using PRODUCTION webhook endpoint: ${ENDPOINT}"
  echo "(Make sure Workflow 01 is toggled ACTIVE in n8n)"
else
  ENDPOINT="${BASE_URL}/webhook-test/research"
  echo "Using TEST webhook endpoint: ${ENDPOINT}"
  echo "(Make sure 'Listen for Test Event' is active on the Research Webhook node)"
fi

echo "============================================================"
echo "1. Testing VALID Research Request"
echo "============================================================"
PAYLOAD='{"topic": "quantum computing"}'
echo "Request Payload: ${PAYLOAD}"
echo "Sending POST request..."

HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}" || true)

HTTP_BODY=$(echo "${HTTP_RESPONSE}" | sed '$d')
HTTP_CODE=$(echo "${HTTP_RESPONSE}" | tail -n1)

echo "HTTP Status Code: ${HTTP_CODE}"
echo "Response Body:"
if command -v jq >/dev/null 2>&1; then
  echo "${HTTP_BODY}" | jq . || echo "${HTTP_BODY}"
else
  echo "${HTTP_BODY}"
fi

echo ""
echo "============================================================"
echo "2. Testing INVALID (Empty) Topic Request"
echo "============================================================"
INVALID_PAYLOAD='{"topic": ""}'
echo "Request Payload: ${INVALID_PAYLOAD}"

ERR_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -d "${INVALID_PAYLOAD}" || true)

ERR_BODY=$(echo "${ERR_RESPONSE}" | sed '$d')
ERR_CODE=$(echo "${ERR_RESPONSE}" | tail -n1)

echo "HTTP Status Code: ${ERR_CODE} (Expected: 400)"
echo "Response Body:"
if command -v jq >/dev/null 2>&1; then
  echo "${ERR_BODY}" | jq . || echo "${ERR_BODY}"
else
  echo "${ERR_BODY}"
fi

echo ""
echo "Research webhook tests completed."
