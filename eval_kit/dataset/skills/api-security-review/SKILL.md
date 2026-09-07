---
name: api-security-review
description: >
  Use when implementing or reviewing authentication, authorization, password reset, OAuth callbacks, API keys, cookies, CSRF protection, rate limits, or security-sensitive logging. The skill applies threat-oriented checks before code changes are considered complete.
license: MIT
metadata:
  author: benchmark-dataset-generator
  version: "1.0"
  domain: coding
  scenario: api-auth-security
---

# API Security Review

## When to Use

- Changing authentication or authorization
- Building password reset or OAuth callbacks
- Handling secrets, cookies, or API keys
- Reviewing a security-sensitive endpoint

## Core Workflow

1. Identify assets and trust boundaries.
2. List abuse cases and authorization checks.
3. Design token, cookie, and secret handling.
4. Implement generic external errors and detailed internal audit.
5. Test negative paths, replay, expiry, and rate limits.

## Reference Files

| Topic | File | Load when |
|---|---|---|
| Password Reset | `references/password-reset.md` | Read when the task directly involves this topic |
| Oauth Callback | `references/oauth-callback.md` | Read when the task directly involves this topic |

## Constraints

### MUST DO

- Authorize every object access.
- Keep secrets out of logs and responses.
- Use bounded token lifetimes and replay protection.

### MUST NOT DO

- Trust client-provided roles.
- Reveal whether an account exists.
- Log raw credentials or bearer tokens.

## Output

Return the changed files or proposed patch, the verification performed, and any remaining risk. Keep unrelated changes out of the final diff.
