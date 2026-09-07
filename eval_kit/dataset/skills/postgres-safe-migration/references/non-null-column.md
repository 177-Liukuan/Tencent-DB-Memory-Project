# Adding a non-null column safely

1. Add the column nullable without a volatile default.
2. Deploy dual-write or application fallback.
3. Backfill in bounded batches with checkpoints.
4. Validate no nulls remain.
5. Add the constraint, then remove compatibility code later.
