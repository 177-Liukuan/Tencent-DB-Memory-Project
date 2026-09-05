# Atomic write

- Write to a temporary file in the destination directory.
- Flush and fsync when durability matters.
- Preserve or intentionally set permissions.
- Replace the destination atomically and clean up temp files on failure.
