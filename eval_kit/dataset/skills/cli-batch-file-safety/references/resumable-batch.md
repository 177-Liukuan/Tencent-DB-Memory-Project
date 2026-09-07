# Resumable batch

- Give each item a stable identifier.
- Persist a checkpoint only after durable completion.
- Make re-running completed items idempotent.
- Summarize completed, skipped, failed, and remaining counts.
