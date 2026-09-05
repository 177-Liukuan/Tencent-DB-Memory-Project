---
name: bugfix-regression-workflow
description: >
  Use when diagnosing and fixing a reproducible or intermittent defect. The skill requires evidence, a failing regression test, controlled test doubles, minimal production changes, and verification that the fix addresses the root cause rather than hiding symptoms.
license: MIT
metadata:
  author: benchmark-dataset-generator
  version: "1.0"
  domain: coding
  scenario: testing-bugfix
---

# Bugfix Regression Workflow

## When to Use

- Fixing a reported defect
- Stabilizing a flaky test
- Diagnosing races or timing bugs
- Adding regression coverage across boundaries

## Core Workflow

1. Reproduce and narrow the failure.
2. Write a deterministic failing regression test.
3. Identify the root cause before editing production code.
4. Apply the smallest fix.
5. Run focused and affected suites, then inspect for overfitting.

## Reference Files

| Topic | File | Load when |
|---|---|---|
| Flaky Test Triage | `references/flaky-test-triage.md` | Read when the task directly involves this topic |
| Race Reproduction | `references/race-reproduction.md` | Read when the task directly involves this topic |

## Constraints

### MUST DO

- Keep the regression test after the fix.
- Control time, randomness, and network at boundaries.
- Document the failure mechanism.

### MUST NOT DO

- Increase arbitrary sleeps to hide flakiness.
- Mock the business logic under test.
- Refactor unrelated code during the bugfix.

## Output

Return the changed files or proposed patch, the verification performed, and any remaining risk. Keep unrelated changes out of the final diff.
