# Testing Guide: AI Research Automation Pipeline

Testing is structured into three progressive levels to guarantee safety, reproducibility, and zero unintended charges.

---

## 1. Test Levels Overview

| Level | Scope | Dependencies | Requires Paid/Live Keys? |
| :--- | :--- | :--- | :--- |
| **Level 1: Static Validation** | JSON syntax, n8n schema conventions, graph connectivity, secret scan | Node.js, Bash | **No** (Runs offline) |
| **Level 2: Mocked Unit Tests** | Data cleansing, RSS parsing, deduplication, date sorting, schema validation, SHA-256 hashing, XSS prevention, error redaction | Node.js | **No** (Runs offline against fixtures) |
| **Level 3: Live Integration** | End-to-end webhook calls, Gemini API generation, Pinecone upsert & query, Gmail delivery | n8n running, Live API keys | **Yes** (Real credentials configured) |

---

## 2. Level 1: Static Validation

Validates workflow JSON integrity, ensures all connected nodes exist, and scans for accidental secrets before committing to Git:

```bash
bash scripts/validate-workflows.sh
```

**Expected Output**:
```
=== Level 1: Static Workflow Validation ===
Scanning workflow directory: /path/to/workflows

Checking [01-research-pipeline.json]...
  ✓ Valid JSON syntax
  ✓ Passed schema, connectivity, and security checks (17 nodes)

Checking [02-research-qa.json]...
  ✓ Valid JSON syntax
  ✓ Passed schema, connectivity, and security checks (12 nodes)

Checking [03-error-notifications.json]...
  ✓ Valid JSON syntax
  ✓ Passed schema, connectivity, and security checks (3 nodes)

All workflows passed Level 1 static validation successfully.
```

---

## 3. Level 2: Local Mocked Unit Tests

Executes 15 discrete unit tests verifying every internal data transform without contacting external APIs:

```bash
node scripts/test-mocked-pipeline.js
```

**Test Coverage**:
1. `Valid research request passes validation`: Verifies string type and length constraints.
2. `Missing or empty topic fails validation`: Tests empty, null, and overflow strings.
3. `Valid QA question passes validation`: Checks bounds between 3 and 500 characters.
4. `Missing or invalid QA question fails validation`: Rejects malformed bodies.
5. `RSS feed parser extracts valid items`: Parses `examples/mock-rss-feed.xml`, cleans HTML tags and entity codes.
6. `Duplicate articles removed and capped at 5`: Eliminates duplicate canonical URLs and sorts by newest timestamp.
7. `Zero articles feed handled cleanly`: Returns non-crashing empty response payload.
8. `Gemini structured output validates against schema`: Enforces required title, summary, key points, and URL match.
9. `Gemini markdown fences stripped safely`: Handles models returning triple backticks.
10. `Malformed Gemini output triggers safe fallback`: Gracefully defaults to RSS feed snippet if LLM hallucinates or returns bad JSON.
11. `Deterministic SHA-256 ID`: Proves identical URLs generate identical 64-character hex IDs.
12. `Pinecone relevance thresholding`: Low similarity scores (`< 0.65`) return honest `insufficient_evidence: true`.
13. `Pinecone grounded sources`: High similarity scores (`>= 0.65`) compile source links and context blocks.
14. `HTML email digest escapes malicious scripts`: Verifies XSS sanitization on `<script>` and HTML injection.
15. `Error notification scrubs credentials`: Masks Gemini keys, Pinecone keys, bearer tokens, and email addresses.

---

## 4. Level 3: Live Integration Tests

Once n8n is running with live credentials configured:

### A. Testing Research Webhook (`POST /research`)
Run the automated test script:

```bash
# Test against active production webhook:
./scripts/test-research-webhook.sh prod

# Or test against n8n test webhook:
./scripts/test-research-webhook.sh test
```

Or manually using `curl`:

```bash
curl -X POST http://localhost:5678/webhook/research \
  -H "Content-Type: application/json" \
  -d '{"topic": "quantum computing"}'
```

**Expected Successful Response (HTTP 200)**:
```json
{
  "success": true,
  "topic": "quantum computing",
  "articles_processed": 5,
  "summaries_stored": 5,
  "digest_sent": true,
  "articles": [ ... ]
}
```

**Expected Validation Error (HTTP 400)**:
```bash
curl -X POST http://localhost:5678/webhook/research \
  -H "Content-Type: application/json" \
  -d '{"topic": ""}'
```
```json
{
  "success": false,
  "error": "Field \"topic\" must be a non-empty string with maximum 200 characters.",
  "code": "INVALID_TOPIC"
}
```

### B. Testing Question Answering Webhook (`POST /research-qa`)
Run the automated test script:

```bash
./scripts/test-qa-webhook.sh prod
```

Or manually with `curl`:

```bash
curl -X POST http://localhost:5678/webhook/research-qa \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the main recent developments in quantum computing?"}'
```

**Expected Grounded Response (HTTP 200)**:
```json
{
  "success": true,
  "question": "What are the main recent developments in quantum computing?",
  "answer": "Recent developments in quantum computing include theoretical physics collaborations to accelerate quantum simulators, updated cryptographic migration timelines from the NSA for post-quantum algorithms, and benchmarks linking hybrid classical-quantum computing workflows using GPU clusters.",
  "sources": [
    {
      "title": "Perimeter Institute Launches New Physics-Driven AI Initiative",
      "source_url": "https://news.google.com/rss/articles/..."
    }
  ],
  "insufficient_evidence": false
}
```

**Expected Out-of-Domain / Insufficient Evidence Response**:
```bash
curl -X POST http://localhost:5678/webhook/research-qa \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the best recipe for baking sourdough bread?"}'
```
```json
{
  "success": true,
  "question": "What is the best recipe for baking sourdough bread?",
  "answer": "I do not have sufficient research in the database to answer this question. No indexed articles met the relevance threshold for your query.",
  "sources": [],
  "insufficient_evidence": true
}
```
