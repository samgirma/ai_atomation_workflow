#!/usr/bin/env bash
# ==============================================================================
# Workflow Static Validation Script
# Validates JSON syntax, n8n schema conventions, connection graph integrity,
# and verifies that no sensitive API keys or credentials are leaked in JSON.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKFLOWS_DIR="${PROJECT_ROOT}/workflows"

echo "=== Level 1: Static Workflow Validation ==="
echo "Scanning workflow directory: ${WORKFLOWS_DIR}"
echo ""

TOTAL_FILES=0
FAILED_FILES=0

# Check node availability
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required to run workflow validation."
  exit 1
fi

node -e '
const fs = require("fs");
const path = require("path");

const workflowsDir = process.argv[1];
const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith(".json"));

if (files.length === 0) {
  console.error("No JSON workflows found in " + workflowsDir);
  process.exit(1);
}

let hasError = false;

// Secret detection patterns
const SECRET_PATTERNS = [
  { name: "Google API Key", regex: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: "Pinecone API Key", regex: /pcsk_[0-9A-Za-z\-_]+/ },
  { name: "OpenAI Secret Key", regex: /sk-[0-9A-Za-z]{20,}/ },
  { name: "GitHub Personal Access Token", regex: /ghp_[0-9A-Za-z]{36}/ },
  { name: "Hardcoded Bearer Token", regex: /Bearer\s+[A-Za-z0-9_\-\.]{30,}/i }
];

files.forEach(file => {
  const filePath = path.join(workflowsDir, file);
  console.log(`Checking [${file}]...`);
  
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`  [FAIL] Unable to read file: ${err.message}`);
    hasError = true;
    return;
  }

  // 1. Validate JSON syntax
  let parsed;
  try {
    parsed = JSON.parse(content);
    console.log("  ✓ Valid JSON syntax");
  } catch (err) {
    console.error(`  [FAIL] JSON parse error: ${err.message}`);
    hasError = true;
    return;
  }

  // 2. Validate top-level n8n workflow structure
  if (!parsed.name || typeof parsed.name !== "string") {
    console.error("  [FAIL] Missing or invalid workflow \"name\"");
    hasError = true;
  }
  if (!Array.isArray(parsed.nodes)) {
    console.error("  [FAIL] Workflow \"nodes\" must be an array");
    hasError = true;
  }
  if (!parsed.connections || typeof parsed.connections !== "object") {
    console.error("  [FAIL] Workflow \"connections\" must be an object");
    hasError = true;
  }

  // 3. Validate node uniqueness and schema
  const nodeNames = new Set();
  const nodeIds = new Set();

  (parsed.nodes || []).forEach(node => {
    if (!node.name) {
      console.error("  [FAIL] Found node with missing name");
      hasError = true;
    } else if (nodeNames.has(node.name)) {
      console.error(`  [FAIL] Duplicate node name detected: "${node.name}"`);
      hasError = true;
    } else {
      nodeNames.add(node.name);
    }

    if (!node.id) {
      console.error(`  [FAIL] Node "${node.name}" is missing unique ID`);
      hasError = true;
    } else if (nodeIds.has(node.id)) {
      console.error(`  [FAIL] Duplicate node ID detected: "${node.id}"`);
      hasError = true;
    } else {
      nodeIds.add(node.id);
    }

    if (!node.type || typeof node.type !== "string") {
      console.error(`  [FAIL] Node "${node.name}" missing node "type"`);
      hasError = true;
    }

    if (!Array.isArray(node.position) || node.position.length !== 2) {
      console.error(`  [FAIL] Node "${node.name}" missing valid [x, y] position`);
      hasError = true;
    }
  });

  // 4. Validate connection referential integrity
  Object.keys(parsed.connections || {}).forEach(sourceNode => {
    if (!nodeNames.has(sourceNode)) {
      console.error(`  [FAIL] Connection source node "${sourceNode}" does not exist in nodes array`);
      hasError = true;
    }

    const connTypes = parsed.connections[sourceNode];
    Object.keys(connTypes).forEach(type => {
      const outputs = connTypes[type];
      if (Array.isArray(outputs)) {
        outputs.forEach(outputBranch => {
          if (Array.isArray(outputBranch)) {
            outputBranch.forEach(target => {
              if (!nodeNames.has(target.node)) {
                console.error(`  [FAIL] Target node "${target.node}" connected from "${sourceNode}" does not exist`);
                hasError = true;
              }
            });
          }
        });
      }
    });
  });

  // 5. Assert zero embedded secrets
  SECRET_PATTERNS.forEach(pattern => {
    if (pattern.regex.test(content)) {
      console.error(`  [FAIL] Security alert: Potential hardcoded ${pattern.name} detected in ${file}!`);
      hasError = true;
    }
  });

  console.log(`  ✓ Passed schema, connectivity, and security checks (${parsed.nodes.length} nodes)`);
  console.log("");
});

if (hasError) {
  console.error("Workflow static validation FAILED. Correct issues before proceeding.");
  process.exit(1);
} else {
  console.log("All workflows passed Level 1 static validation successfully.");
}
' "${WORKFLOWS_DIR}"
