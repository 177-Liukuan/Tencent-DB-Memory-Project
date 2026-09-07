---
name: typescript-service-change-safety
description: >
  Use when changing a TypeScript service across public types, HTTP clients, validation, error handling, callers, and tests. Apply this skill for non-trivial API additions, contract migrations, cancellation, retry behavior, or cross-file refactors where a local edit may break downstream code.
license: MIT
metadata:
  author: benchmark-dataset-generator
  version: "1.0"
  domain: coding
  scenario: node-typescript-api
---

# TypeScript Service Change Safety

## When to Use

- Adding or changing a public TypeScript API or DTO
- Implementing HTTP cancellation, timeout, or retry behavior
- Introducing typed business errors and validation boundaries
- Refactoring a service across callers and tests

## Core Workflow

1. Map the public surface and find every caller before editing.
2. Write or update focused tests for the changed behavior.
3. Change types and runtime validation together.
4. Implement the smallest production change and preserve error semantics.
5. Run type-checking and affected tests, then inspect the final diff.

## Reference Files

| Topic | File | Load when |
|---|---|---|
| Public Contract Migration | `references/public-contract-migration.md` | Read when the task directly involves this topic |
| Http Cancellation Retry | `references/http-cancellation-retry.md` | Read when the task directly involves this topic |

## Constraints

### MUST DO

- Keep compile-time types and runtime validation consistent.
- Use AbortSignal for cancellation of external requests.
- Update callers and tests when a public contract changes.

### MUST NOT DO

- Use any to bypass a migration.
- Retry non-idempotent writes without an explicit idempotency design.
- Change unrelated formatting across the repository.

## Output

Return the changed files or proposed patch, the verification performed, and any remaining risk. Keep unrelated changes out of the final diff.
