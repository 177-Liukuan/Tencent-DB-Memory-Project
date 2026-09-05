---
name: docker-linux-deployment
description: >
  Use when containerizing or deploying a service on Linux, especially for multi-stage builds, non-root execution, health/readiness checks, graceful shutdown, Compose configuration, resource limits, logs, or systemd integration.
license: MIT
metadata:
  author: benchmark-dataset-generator
  version: "1.0"
  domain: coding
  scenario: docker-linux-ops
---

# Docker Linux Deployment

## When to Use

- Creating or hardening a Docker image
- Adding health and readiness checks
- Implementing graceful shutdown
- Deploying with Compose or systemd

## Core Workflow

1. Inspect runtime and build dependencies.
2. Build a minimal multi-stage image.
3. Run as a non-root user with explicit filesystem permissions.
4. Define health, readiness, shutdown, and resource limits.
5. Test build, startup, signal handling, and rollback.

## Reference Files

| Topic | File | Load when |
|---|---|---|
| Graceful Shutdown | `references/graceful-shutdown.md` | Read when the task directly involves this topic |
| Container Hardening | `references/container-hardening.md` | Read when the task directly involves this topic |

## Constraints

### MUST DO

- Pin base images appropriately.
- Handle SIGTERM and stop accepting work.
- Send logs to stdout/stderr.

### MUST NOT DO

- Run as root without a justified need.
- Bake secrets into the image.
- Use a health check that depends on slow external services.

## Output

Return the changed files or proposed patch, the verification performed, and any remaining risk. Keep unrelated changes out of the final diff.
