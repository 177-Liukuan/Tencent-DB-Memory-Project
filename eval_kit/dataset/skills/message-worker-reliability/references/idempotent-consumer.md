# Idempotent consumer

1. Derive a stable business idempotency key.
2. Insert or claim the key in the same transaction as the side effect.
3. Treat an existing completed key as success.
4. Do not acknowledge until the transaction commits.
