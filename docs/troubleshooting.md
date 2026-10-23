# Troubleshooting & Operational Guide

This document covers common operational failure modes, error messages, and remediation steps for the AI Research Automation Pipeline.

---

## 1. Webhook Issues

### A. HTTP 404: "Workflow is not registered" / "Webhook not found"
* **Cause**: You called the production webhook endpoint (`/webhook/research`) while the workflow is **inactive**, or you called the test endpoint (`/webhook-test/research`) without clicking **Listen for Test Event** in the n8n UI.
* **Fix**:
  1. If testing manually via curl, toggle the workflow switch to **Active** in the top right corner of the n8n workflow editor.
  2. Ensure you are using the correct URL path:
     - Active workflow: `http://localhost:5678/webhook/research`
     - Test run in editor: `http://localhost:5678/webhook-test/research`

### B. HTTP 400: "Field 'topic' must be a non-empty string"
* **Cause**: The incoming POST body does not include a `topic` string, or the `Content-Type: application/json` header was omitted.
* **Fix**:
  Ensure your request includes headers and a valid JSON body:
  ```bash
  curl -X POST http://localhost:5678/webhook/research \
    -H "Content-Type: application/json" \
    -d '{"topic": "quantum computing"}'
  ```

---

## 2. Google Gemini API Errors

### A. HTTP 429: "Resource has been exhausted (quota exceeded)"
* **Cause**: Google AI Studio free tier rate limits (typically 15 Requests Per Minute for Flash models, and 1,500 requests per day).
* **Fix**:
  1. The pipeline includes bounded retries (`maxRetries: 3`, `retryInterval: 2000ms`).
  2. Keep article processing capped at 5 articles per run (default in `Parse, Clean & Top 5 Articles`).
  3. If testing frequently, pause 60 seconds between manual batch triggers.

### B. HTTP 400 / 403: "API key not valid"
* **Cause**: `GEMINI_API_KEY` is either missing, contains extra whitespace, or lacks the generative language API permission.
* **Fix**:
  Verify your key with a direct curl test:
  ```bash
  curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}" | head -n 10
  ```

### C. Gemini Returns Markdown Fences around JSON (` ```json `)
* **Cause**: Large Language Models occasionally include markdown fences even when instructed not to.
* **Handled by Workflow**: The `Validate Gemini Output` Code node automatically strips `^```json` and ````$` regex wrappers before calling `JSON.parse()`.

---

## 3. Pinecone Vector Database Errors

### A. HTTP 400: "Vector dimension (768) does not match the index dimension (1536)"
* **Cause**: The Pinecone index was created with OpenAI default dimensions (1536) instead of Google Gemini embedding dimensions (768).
* **Fix**:
  1. In Pinecone Console, delete the mismatched index.
  2. Create a new index:
     - **Name**: `research-pipeline-index`
     - **Dimensions**: `768`
     - **Metric**: `Cosine`
     - **Mode**: `Serverless`

### B. HTTP 404 / 403: "Index not found" or "Unauthorized"
* **Cause**: `PINECONE_INDEX_HOST` or `PINECONE_API_KEY` is misconfigured.
* **Fix**:
  1. In Pinecone Console, open your index and copy the **Host URL** (e.g., `research-pipeline-index-xxxx.svc.us-east-1.pinecone.io`).
  2. Ensure the host is set in `.env` as `PINECONE_INDEX_HOST` without `https://`.

---

## 4. Gmail & Google Cloud OAuth2 Errors

### A. "Access Blocked: App has not completed the Google verification process"
* **Cause**: Your Google Cloud OAuth consent screen is configured as **External** and in "Testing" mode, but your email address was not added as a test user.
* **Fix**:
  1. Go to Google Cloud Console > **APIs & Services** > **OAuth consent screen**.
  2. Scroll down to **Test users**.
  3. Click **Add Users** and enter your personal Google email address.
  4. Save and retry the OAuth handshake in n8n.

### B. "Redirect URI mismatch" (Error 400: redirect_uri_mismatch)
* **Cause**: The Authorized redirect URI in Google Cloud does not exactly match n8n's callback URL.
* **Fix**:
  Ensure the URI configured in Google Cloud Credentials under **Authorized redirect URIs** is exactly:
  ```
  http://localhost:5678/rest/oauth2-credential/callback
  ```

---

## 5. Global Error Handling Assignment

To ensure uncaught execution failures automatically trigger email alerts:
1. Open Workflow 01 (`01 - AI Research Pipeline`) in the n8n editor.
2. Click the gear icon (**Workflow Settings**) in the upper right.
3. In the **Error Workflow** dropdown, select **03 - Error Notifications**.
4. Repeat this step for Workflow 02 (`02 - Research Question Answering`).
5. Save both workflows.
