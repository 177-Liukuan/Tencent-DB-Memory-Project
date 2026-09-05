# Password reset

- Return the same public response for existing and absent accounts.
- Store a hash of a single-use token with an expiry.
- Revoke all active reset tokens after successful use.
- Rate-limit request and consume endpoints separately.
