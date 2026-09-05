# Transaction boundaries

- Open the session in a FastAPI dependency.
- Keep the transaction around the minimal database write set.
- Never hold a transaction open while awaiting a remote service.
- Commit once, roll back on failure, and test rollback behavior.
