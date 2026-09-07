# Async search

- Debounce only when it improves UX; do not use delay as correctness.
- Cancel superseded requests with AbortController.
- Associate each result with the latest request.
- Test out-of-order responses and keyboard navigation.
