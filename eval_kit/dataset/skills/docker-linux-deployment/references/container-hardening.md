# Container hardening

- Use a multi-stage build and copy only runtime artifacts.
- Run with a fixed non-root UID/GID.
- Use a read-only root filesystem where feasible.
- Drop unnecessary capabilities and set resource limits.
