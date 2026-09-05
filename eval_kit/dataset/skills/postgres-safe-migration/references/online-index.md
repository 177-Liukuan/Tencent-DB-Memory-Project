# Online index creation

- Use `CREATE INDEX CONCURRENTLY` outside an explicit transaction.
- Monitor invalid indexes and retry cleanup safely.
- Verify the planner uses the index before removing alternatives.
