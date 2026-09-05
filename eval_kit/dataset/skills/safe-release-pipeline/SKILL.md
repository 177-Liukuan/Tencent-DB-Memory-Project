---
name: safe-release-pipeline
description: >
  Use when designing or changing CI/CD, release gates, artifact provenance, canary or blue-green deployment, database migration gates, rollback automation, or release documentation. The skill focuses on reproducibility, promotion of the same artifact, and explicit stop conditions.
license: MIT
metadata:
  author: benchmark-dataset-generator
  version: "1.0"
  domain: coding
  scenario: cicd-release
---

# Safe Release Pipeline

## When to Use

- Changing CI or release workflows
- Adding migration or quality gates
- Implementing canary/blue-green deployment
- Designing rollback and artifact promotion

## Core Workflow

1. Map build, test, artifact, deploy, and rollback stages.
2. Build once and attach provenance.
3. Define mandatory gates and protected environments.
4. Deploy progressively with health criteria.
5. Automate rollback and preserve evidence.

## Reference Files

| Topic | File | Load when |
|---|---|---|
| Migration Gate | `references/migration-gate.md` | Read when the task directly involves this topic |
| Progressive Delivery | `references/progressive-delivery.md` | Read when the task directly involves this topic |

## Constraints

### MUST DO

- Promote the same immutable artifact.
- Make rollback executable.
- Block deployment on failed mandatory gates.

### MUST NOT DO

- Rebuild separately for production.
- Ignore migration compatibility.
- Use a manual checklist as the only rollback mechanism.

## Output

Return the changed files or proposed patch, the verification performed, and any remaining risk. Keep unrelated changes out of the final diff.
