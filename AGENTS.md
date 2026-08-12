# Global Codex Operating Rules

## Core engineering behavior

Apply the `karpathy-guidelines` skill to coding, refactoring, debugging, and code review: surface assumptions, prefer simple surgical changes, and define verifiable success criteria before substantial edits.

Use the relevant [@superpowers](plugin://superpowers@openai-curated-remote) workflows for nontrivial creation and coding. Keep read-only questions and trivial edits direct.

For large or dense files, divide implementation into named slices. State the section or behavior affected, the exact intended change, and the smallest verification required before continuing.

Preserve existing user changes and dirty worktrees. Do not perform destructive or externally consequential actions without clear authority.

If essential information is missing, state exactly what is needed. Otherwise, proceed without unnecessary ceremony.

Use parallel agents only for independent, read-only, or separate-worktree tasks. The main agent retains ownership of shared state, final acceptance, and risk gates. Do not allow concurrent writes to the same files, databases, manifests, collectors, or other shared mutable state.

## Agent model and concurrency routing

- The root orchestrator uses the model and reasoning level selected by the user in the task composer beside the microphone. Do not replace or second-guess that selection from an agent workflow.
- Subagents must not inherit or reuse the orchestrator model. Every subagent dispatch must explicitly use model `gpt-5.6-terra` with reasoning effort `max`, including implementers, reviewers, nested reviewers, and agents spawned by other subagents.
- Do not override the global subagent route with Luna, Sol, the session default, or skill-specific cost-tier routing unless the user explicitly requests a different subagent model for that task.
- The concurrency ceiling is six active agents total per session: one root orchestrator plus at most five active subagents. Nested subagents count toward the same five-subagent allowance. Check the live agent tree before spawning and never exceed this total.
- A model-routing or concurrency configuration change is not retroactive. Existing agents keep their launch model and running sessions may require a new task or application reload before a changed runtime cap is available.

## Branch workflow

- Do not interrupt or rewrite the active CH Ultimate release candidate, its exact-commit gates, or its physical acceptance work.
- After the active release candidate is completed, commit this repository guidance directly on the updated `main` branch and use `main` for future CH Ultimate work.
- Do not create another feature branch or worktree unless the user explicitly requests it.
- Preserve existing branches, worktrees, and dirty changes until they are audited. Do not delete, reset, or merge them merely to enforce the future `main`-only workflow.

## Context7

Use Context7 on demand only when an answer depends on the exact installed version of a library, framework, SDK, plugin, or API. Inspect the project's manifest or lockfile first and include the relevant version in the documentation query.

Do not use Context7 when business logic is already defined locally, the API is stable and adequately documented in the repository, or first-party Apple APIs are better served by current official Apple documentation.

## Matt Pocock skills

Use Matt Pocock skills selectively when requirements are ambiguous, a high-impact plan needs deeper alignment, or work must move between tasks or agents. Prefer focused skills such as `grill-me`, `grill-with-docs`, `handoff`, or `domain-modeling` when their exact trigger applies.

Do not stack Matt Pocock workflows on top of equivalent Superpowers workflows merely because both are installed. Prefer Superpowers for TDD, systematic debugging, implementation planning, code review, verification, and worktree orchestration unless the user explicitly requests a Matt Pocock workflow.

## Caveman

Use `caveman` only when the user explicitly requests it or for a repeatable operational task where the answer is primarily the condition or result, such as: "Did the build pass?", "Summarize this diff", "What failed?", or routine task status.

Do not use Caveman for architecture decisions, security reviews, migrations, quantitative conclusions, debugging, handoffs, destructive actions, or anything requiring evidence, explanation, or nuance. Even in Caveman mode, preserve exact errors, counts, warnings, verification evidence, and safety language.

--- project-doc ---

# CH Ultimate Repository Rules

CH Ultimate is currently a frontend-only Electron demo.

- Keep all business data in memory. Do not add a backend, database, persistence, sync, NAS integration, or production printing unless the user explicitly starts that phase.
- Keep the renderer behind the `OperationsGateway` interface so a future NAS API can replace the mock adapter without rewriting feature screens.
- Use Indonesian UI copy, integer rupiah, WITA display, and the monochrome CH Nota-inspired design system.
- Prefer simple, surgical implementations. State assumptions, avoid speculative abstractions, and define a verifiable success criterion before substantial edits.
- Develop behavior test-first. Run focused tests after each slice and the full verification suite before commits.
- Treat `/Users/hamlet/Documents/CH Nota` as read-only. Port only relevant renderer behavior from its current working tree; never reset, commit, or edit it.
