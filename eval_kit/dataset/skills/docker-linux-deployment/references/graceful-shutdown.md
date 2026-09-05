# Graceful shutdown

- Trap SIGTERM/SIGINT.
- Mark readiness false before draining.
- Stop accepting new work, wait for in-flight work with a deadline, then exit.
- Test the signal path with a real child process or container.
