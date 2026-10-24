#!/usr/bin/env python3
import json
import sqlite3
import os
import sys

DB_PATH = os.path.expanduser("~/.n8n/database.sqlite")

def sync_workflows():
    if not os.path.exists(DB_PATH):
        print(f"Error: {DB_PATH} does not exist", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("SELECT id FROM credentials_entity WHERE type = 'gmailOAuth2' LIMIT 1")
    cred_row = cur.fetchone()
    gmail_cred_id = cred_row[0] if cred_row else "q1gDnxzLs1QUamh3"
    print(f"Using Gmail OAuth2 Credential ID: {gmail_cred_id}")

    workflows_to_sync = [
        {
            "id": "RqYZ8Bf4zJA8OX5S",
            "file": "workflows/01-research-pipeline.json",
            "name": "01 - AI Research Pipeline"
        },
        {
            "id": "xNe0JpiuocWHbDVW",
            "file": "workflows/02-research-qa.json",
            "name": "02 - Research Question Answering"
        },
        {
            "id": "GZ80ZK4QlyI03obG",
            "file": "workflows/03-error-notifications.json",
            "name": "03 - Error Notifications"
        }
    ]

    for item in workflows_to_sync:
        file_path = os.path.join(os.path.dirname(__file__), "..", item["file"])
        with open(file_path, "r", encoding="utf-8") as f:
            wf_data = json.load(f)

        for node in wf_data.get("nodes", []):
            if node.get("type") == "n8n-nodes-base.gmail":
                node["credentials"] = {
                    "gmailOAuth2": {
                        "id": gmail_cred_id,
                        "name": "Gmail account"
                    }
                }

        nodes_json = json.dumps(wf_data.get("nodes", []))
        connections_json = json.dumps(wf_data.get("connections", {}))

        cur.execute("SELECT activeVersionId FROM workflow_entity WHERE id = ?", (item["id"],))
        row = cur.fetchone()
        if not row:
            print(f"Workflow {item['id']} not found in DB! Skipping.")
            continue

        active_version_id = row[0]

        cur.execute(
            """
            UPDATE workflow_entity 
            SET nodes = ?, connections = ?, updatedAt = datetime('now')
            WHERE id = ?
            """,
            (nodes_json, connections_json, item["id"])
        )

        if active_version_id:
            cur.execute(
                """
                UPDATE workflow_history
                SET nodes = ?, connections = ?, updatedAt = datetime('now')
                WHERE workflowId = ? AND versionId = ?
                """,
                (nodes_json, connections_json, item["id"], active_version_id)
            )

        print(f"✓ Successfully synced {item['name']} (ID: {item['id']}, Version: {active_version_id})")

    conn.commit()
    conn.close()
    print("All workflows successfully synchronized to n8n database.")

if __name__ == "__main__":
    sync_workflows()
