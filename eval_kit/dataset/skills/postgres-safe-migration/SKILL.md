---
name: postgres-safe-migration
description: >
  Use when changing a PostgreSQL schema or large dataset in production. Apply this skill for non-null columns, indexes, backfills, constraints, rollback planning, compatibility windows, and migrations that could lock a busy table.
license: MIT
metadata:
  author: benchmark-dataset-generator
  version: "1.0"
  domain: coding
  scenario: postgres-migrations
---

# PostgreSQL Safe Migration

## When to Use

- Adding columns or constraints to populated tables
- Building indexes on large tables
- Backfilling data safely
- Planning rollback and compatibility

## Core Workflow

1. Inspect table size and write paths.
2. Split expand, backfill, validate, and contract phases.
3. Choose online-safe DDL where possible.
4. Make the migration resumable and observable.
5. Provide verification and rollback instructions.

## Reference Files

| Topic | File | Load when |
|---|---|---|
| Non Null Column | `references/non-null-column.md` | Read when the task directly involves this topic |
| Online Index | `references/online-index.md` | Read when the task directly involves this topic |

## Constraints

### MUST DO

- Separate long backfills from DDL transactions.
- Plan rollback before deployment.
- Verify application compatibility at every phase.

### MUST NOT DO

- Add a blocking default to a huge table without analysis.
- Build a large index with a blocking command in peak traffic.
- Delete old fields before a compatibility window.

## Output

Return the changed files or proposed patch, the verification performed, and any remaining risk. Keep unrelated changes out of the final diff.
