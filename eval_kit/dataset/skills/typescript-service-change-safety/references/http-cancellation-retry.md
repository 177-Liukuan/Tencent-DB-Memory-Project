# HTTP cancellation and retry

- Use AbortController/AbortSignal so cancellation reaches the transport.
- Retry only idempotent reads by default.
- Use bounded exponential backoff with jitter.
- Surface the final typed error with attempt metadata, without logging secrets.
