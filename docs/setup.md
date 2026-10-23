# Setup & Deployment Guide: AI Research Automation Pipeline

This guide walks you through setting up your local n8n instance, generating API credentials, configuring the Pinecone vector index, setting up Google Cloud Gmail OAuth2, and importing the workflows.

---

## 1. Prerequisites

- **Operating System**: Linux / macOS / Windows (WSL recommended)
- **Node.js**: `v24.0.0` or higher (verified on Node `v24.20.0`)
- **Git**: Installed for version control

---

## 2. Setting Up Environment Variables

Copy the template `.env.example` to `.env`:

```bash
cp .env.example .env
```

Open `.env` and fill in your values (or configure them directly inside the n8n UI as described below):

```ini
GEMINI_API_KEY=your_gemini_api_key_here
PINECONE_API_KEY=your_pinecone_api_key_here
PINECONE_INDEX_NAME=research-pipeline-index
PINECONE_INDEX_HOST=research-pipeline-index-xxxxxxx.svc.pinecone.io
PINECONE_MIN_RELEVANCE=0.65
GMAIL_RECIPIENT=your_email@gmail.com
DEFAULT_RESEARCH_TOPIC=quantum computing
N8N_BASE_URL=http://localhost:5678
```

---

## 3. Starting n8n Locally

Run n8n directly using `npx`:

```bash
# Start n8n locally with environment variables loaded
env $(cat .env | grep -v '^#' | xargs) npx n8n
```

Once running, navigate to:
[http://localhost:5678](http://localhost:5678)

> [!NOTE]
> The n8n process must remain running in your terminal (or run under `systemd` / `tmux`) for local scheduled cron triggers to execute automatically at 8:00 AM.

---

## 4. API Accounts & Key Configuration

### A. Google Gemini API Key
1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Click **Get API key** > **Create API key**.
4. Copy the API key and set it in your `.env` as `GEMINI_API_KEY`.
5. Supported Models:
   - Generation: `gemini-3.8-flash` (or `gemini-1.5-flash`)
   - Embedding: `text-embedding-004` (768 dimensions)

### B. Pinecone Vector Database
1. Go to [Pinecone Console](https://app.pinecone.io/) and create a free tier account.
2. In the dashboard, click **Create Index**:
   - **Index Name**: `research-pipeline-index`
   - **Dimensions**: `768` (Must match Gemini embedding output!)
   - **Metric**: `Cosine`
   - **Capacity Mode**: `Serverless` (Free tier on AWS / GCP)
3. Under **API Keys**, copy your API key and set `PINECONE_API_KEY`.
4. Copy the **Index Host URL** (e.g., `research-pipeline-index-abc1234.svc.aped-4627-b74a.pinecone.io`) and set `PINECONE_INDEX_HOST`.

### C. Gmail OAuth2 Setup in Google Cloud
To enable automated digest delivery and error alerting via Gmail:
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `n8n-automation-pipeline`).
3. Navigate to **APIs & Services** > **Library**:
   - Search for **Gmail API** and click **Enable**.
4. Configure **OAuth consent screen**:
   - User Type: **External**
   - App Name: `n8n Research Mailer`
   - User support email & Developer contact: your email
   - Under **Scopes**, click **Add or Remove Scopes** and select:
     - `https://www.googleapis.com/auth/gmail.send` (Send emails on your behalf)
   - Under **Test Users**, add your personal Gmail address.
5. Create OAuth Credentials:
   - Go to **APIs & Services** > **Credentials**.
   - Click **Create Credentials** > **OAuth client ID**.
   - Application type: **Web application**.
   - Name: `n8n Local Client`.
   - Under **Authorized redirect URIs**, add:
     ```
     http://localhost:5678/rest/oauth2-credential/callback
     ```
   - Click **Create** and copy your **Client ID** and **Client Secret**.
6. Connect Credentials in n8n:
   - In n8n, navigate to **Credentials** > **New Credential** > **Gmail OAuth2 API**.
   - Enter your Client ID and Client Secret.
   - Click **Sign in with Google** and approve access for your test account.

---

## 5. Workflow Import & Activation Order

Import the workflows in the following sequence:

### Step 1: Import Workflow 3 (Error Notifications)
1. In the n8n UI, click **Workflows** > **Import from File**.
2. Select `workflows/03-error-notifications.json`.
3. In the `Send Error Email via Gmail` node, select your connected `gmailOAuth2` credential.
4. Toggle the workflow to **Active**.
5. Note the workflow ID in the URL bar (e.g., `http://localhost:5678/workflow/3`).

### Step 2: Import Workflow 1 (AI Research Pipeline)
1. Click **Workflows** > **Import from File**.
2. Select `workflows/01-research-pipeline.json`.
3. In the top-right menu, open **Workflow Settings**:
   - Under **Error Workflow**, select **03 - Error Notifications**.
4. In the `Send Gmail Digest` node, select your connected `gmailOAuth2` credential.
5. Toggle the workflow to **Active**.

### Step 3: Import Workflow 2 (Research Question Answering)
1. Click **Workflows** > **Import from File**.
2. Select `workflows/02-research-qa.json`.
3. Under **Workflow Settings**, assign **03 - Error Notifications** as the error workflow.
4. Toggle the workflow to **Active**.
