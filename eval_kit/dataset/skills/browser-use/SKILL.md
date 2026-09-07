---
name: browser-use
description: >
  Use when a task requires opening and interacting with web pages, filling forms, taking screenshots, extracting browser-rendered data, connecting to an existing Chrome session, managing multiple sessions, or using Chrome DevTools Protocol for advanced browser control.
license: MIT
metadata:
  author: benchmark-dataset-generator
  version: "1.0"
  domain: coding
  scenario: browser-automation
---

# Browser Use

## When to Use

- Automating a user journey in a browser
- Capturing screenshots or rendered data
- Connecting to an existing Chrome profile
- Using raw CDP for capabilities not exposed by the high-level API

## Core Workflow

1. Inspect the page and choose stable semantic locators.
2. Create or connect to the correct browser session.
3. Perform actions with explicit observable waits.
4. Capture requested evidence and handle downloads/popups.
5. Close only sessions created by the task and report artifacts.

## Reference Files

| Topic | File | Load when |
|---|---|---|
| Session Management | `references/session-management.md` | Read when the task directly involves this topic |
| Stable Locators | `references/stable-locators.md` | Read when the task directly involves this topic |

## Constraints

### MUST DO

- Prefer role, label, text, or data-testid locators.
- Wait for observable state, not arbitrary time.
- Keep user profiles and sessions isolated.

### MUST NOT DO

- Use brittle nth-child selectors when a semantic locator exists.
- Expose cookies or credentials in logs.
- Kill a user-owned browser session.

## Output

Return the changed files or proposed patch, the verification performed, and any remaining risk. Keep unrelated changes out of the final diff.
