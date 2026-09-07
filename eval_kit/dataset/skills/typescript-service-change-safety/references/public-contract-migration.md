# Public contract migration

1. Search definitions, re-exports, callers, mocks, and tests.
2. Add the new type shape and a temporary adapter only when compatibility is required.
3. Migrate callers in one bounded change.
4. Remove the adapter after all callers compile.
5. Run `pnpm typecheck` and the affected test suite.
