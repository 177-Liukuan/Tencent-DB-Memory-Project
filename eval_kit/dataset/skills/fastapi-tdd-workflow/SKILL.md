---
name: fastapi-tdd-workflow
description: >
  Use when implementing or changing FastAPI endpoints, dependencies, database transactions, exception mapping, or asynchronous integrations. This skill enforces a tests-first workflow and keeps request validation, service logic, persistence, and HTTP translation separated.
license: MIT
metadata:
  author: benchmark-dataset-generator
  version: "1.0"
  domain: coding
  scenario: python-fastapi
---

# FastAPI TDD Workflow

## When to Use

- Adding a FastAPI route with non-trivial validation or persistence
- Converting blocking integrations to async httpx calls
- Changing dependency injection or transaction boundaries
- Fixing endpoint behavior that requires a regression test

## Core Workflow

1. Read neighboring routes, schemas, dependencies, and tests.
2. Write a failing API-level or service-level test.
3. Define Pydantic request/response models and error cases.
4. Implement service logic and keep the route thin.
5. Run focused pytest, then the affected suite and static checks.

## Reference Files

| Topic | File | Load when |
|---|---|---|
| Async Integration | `references/async-integration.md` | Read when the task directly involves this topic |
| Transaction Boundaries | `references/transaction-boundaries.md` | Read when the task directly involves this topic |

## Constraints

### MUST DO

- Use Pydantic v2 validation explicitly.
- Keep database sessions in dependencies.
- Test both success and failure paths.

### MUST NOT DO

- Create sessions inside route handlers.
- Block the event loop with synchronous HTTP calls.
- Return raw internal exceptions to clients.

## Output

Return the changed files or proposed patch, the verification performed, and any remaining risk. Keep unrelated changes out of the final diff.
