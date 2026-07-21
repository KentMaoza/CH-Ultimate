# CH Ultimate Repository Rules

CH Ultimate is currently a frontend-only Electron demo.

- Keep all business data in memory. Do not add a backend, database, persistence, sync, NAS integration, or production printing unless the user explicitly starts that phase.
- Keep the renderer behind the `OperationsGateway` interface so a future NAS API can replace the mock adapter without rewriting feature screens.
- Use Indonesian UI copy, integer rupiah, WITA display, and the monochrome CH Nota-inspired design system.
- Prefer simple, surgical implementations. State assumptions, avoid speculative abstractions, and define a verifiable success criterion before substantial edits.
- Develop behavior test-first. Run focused tests after each slice and the full verification suite before commits.
- Treat `/Users/hamlet/Documents/CH Nota` as read-only. Port only relevant renderer behavior from its current working tree; never reset, commit, or edit it.
