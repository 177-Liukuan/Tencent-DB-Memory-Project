---
name: cli-batch-file-safety
description: >
  Use when building command-line tools or batch processors that modify files, perform destructive operations, resume work, merge configuration, report partial failures, or need reliable cross-platform behavior. The skill emphasizes dry-run, atomic writes, exit codes, checkpoints, and clear summaries.
license: MIT
metadata:
  author: benchmark-dataset-generator
  version: "1.0"
  domain: coding
  scenario: cli-file-processing
---

# CLI Batch File Safety

## When to Use

- Building a destructive or batch CLI
- Writing files safely
- Adding resume/checkpoint behavior
- Defining configuration precedence and exit codes

## Core Workflow

1. Define inputs, outputs, and failure contract.
2. Add help, validation, dry-run, and deterministic planning.
3. Perform atomic or resumable writes.
4. Track success, skipped, and failed items.
5. Return documented exit codes and test interruption paths.

## Reference Files

| Topic | File | Load when |
|---|---|---|
| Atomic Write | `references/atomic-write.md` | Read when the task directly involves this topic |
| Resumable Batch | `references/resumable-batch.md` | Read when the task directly involves this topic |

## Constraints

### MUST DO

- Use atomic replacement for final files.
- Offer dry-run for destructive actions.
- Report partial failures explicitly.

### MUST NOT DO

- Silently overwrite files.
- Return success when items failed.
- Assume one platform path syntax.

## Output

Return the changed files or proposed patch, the verification performed, and any remaining risk. Keep unrelated changes out of the final diff.
