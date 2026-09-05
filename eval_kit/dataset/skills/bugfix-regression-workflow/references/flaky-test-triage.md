# Flaky test triage

- Run repeatedly with a fixed seed and capture timing/order.
- Isolate global state, time, randomness, filesystem, and network.
- Replace arbitrary sleeps with an observable condition.
- Keep a deterministic regression test for the discovered cause.
