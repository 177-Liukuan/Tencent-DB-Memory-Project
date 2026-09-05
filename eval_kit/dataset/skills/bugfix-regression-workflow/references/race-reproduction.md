# Race reproduction

- Add controllable barriers around the suspected interleaving.
- Drive the two operations in a known order.
- Assert the forbidden state before applying the fix.
- Remove only diagnostic hooks, not the regression coverage.
