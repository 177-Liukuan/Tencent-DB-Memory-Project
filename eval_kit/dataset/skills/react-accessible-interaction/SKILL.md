---
name: react-accessible-interaction
description: >
  Use when building or refactoring non-trivial React interactions such as forms, dialogs, async search, focus management, custom hooks, or large lists. The skill combines accessibility, predictable state, cleanup, race handling, and user-focused tests.
license: MIT
metadata:
  author: benchmark-dataset-generator
  version: "1.0"
  domain: coding
  scenario: react-frontend
---

# React Accessible Interaction

## When to Use

- Building accessible forms or dialogs
- Handling async UI races and cancellation
- Creating reusable hooks with cleanup
- Optimizing large interactive lists

## Core Workflow

1. Map state and user interactions.
2. Choose semantic HTML and focus behavior.
3. Implement the smallest state model.
4. Handle async cancellation and effect cleanup.
5. Test by role and observable behavior.

## Reference Files

| Topic | File | Load when |
|---|---|---|
| Dialog Focus | `references/dialog-focus.md` | Read when the task directly involves this topic |
| Async Search | `references/async-search.md` | Read when the task directly involves this topic |

## Constraints

### MUST DO

- Use semantic controls and labels.
- Clean up effects and subscriptions.
- Test keyboard and failure states.

### MUST NOT DO

- Use div click handlers for buttons.
- Use array indexes as keys for changing lists.
- Hide race conditions with arbitrary sleeps.

## Output

Return the changed files or proposed patch, the verification performed, and any remaining risk. Keep unrelated changes out of the final diff.
