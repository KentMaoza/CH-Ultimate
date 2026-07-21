# CH Ultimate Wiki Schema

This vault follows the LLM wiki pattern from [Karpathy's LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

## Layers and ownership

- `raw/` contains curated source material and is immutable. Do not edit, rename, or delete a source after it is added.
- `wiki/` contains maintained, LLM-generated knowledge pages. Keep it concise, linked, and evidence-led.
- `wiki/index.md` is the content catalog. Update it whenever a wiki page is created, renamed, or materially reframed.
- `wiki/log.md` is append-only. Add one dated entry after every ingest, filed query, or lint pass.

## Ingesting a source

1. Inspect the new file under `raw/` and identify its title, author or publisher, publication date, and limitations.
2. Create one summary in `wiki/sources/` with YAML frontmatter: `type`, `title`, `description`, `tags`, `timestamp`, and `sources`.
3. Update only the entity, concept, comparison, or overview pages that the source materially changes. Link claims to the summary and flag conflicts instead of silently resolving them.
4. Update `wiki/index.md` and append `## [YYYY-MM-DD] ingest | <title>` to `wiki/log.md`.

Never present an inference as a source fact. Preserve disagreements, uncertainty, assumptions, and timestamps.

## Answering questions

Read `wiki/index.md` first, then the relevant linked pages and their source summaries. Cite the supporting wiki pages. File a durable answer in `wiki/analyses/` only when it adds reusable synthesis; then add it to the index and log.

## Maintaining the wiki

On a lint request, check for missing frontmatter, stale or superseded claims, unlinked pages, missing concept or entity pages, duplicate topics, and overview drift. Report proposed content changes before applying uncertain ones. Never delete or modify raw sources.

## Conventions

- Use lowercase kebab-case filenames.
- Prefer Obsidian wiki links such as `[[overview]]` and `[[sources/example-source]]`.
- Keep one page per durable topic. Extend or revise an existing page rather than making near-duplicates.
- Keep analytical claims explicitly tied to the underlying source summaries.
