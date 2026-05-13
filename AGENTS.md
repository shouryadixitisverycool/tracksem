# AGENTS

## Commands
- Use Bun in this repo: `bun install`, `bun run dev`, `bun run check`, `bun run build`.
- There are no repo scripts for linting or tests right now. Default verification is `bun run check` and `bun run build`.
- Current baseline: both commands pass; `src/routes/course/[id]/+page.svelte` emits 8 existing Svelte a11y warnings about unassociated `label`s, and `bun run build` may print the adapter-auto production-environment notice.

## Architecture
- This is a single SvelteKit app, not a monorepo. Main routes are `src/routes/+page.svelte` (dashboard), `src/routes/course/[id]/+page.svelte` (course editor), and `src/routes/auth/+page.svelte`.
- The app is in local SQLite mode. `src/routes/auth/+page.svelte` is only an informational page, and `src/routes/+layout.server.ts` returns a fake `local sqlite` user.
- `src/hooks.server.ts` is currently a pass-through SvelteKit handle; there is no active Supabase auth/session wiring.
- `svelte.config.js` uses `@sveltejs/adapter-auto`; local dev/build run through plain SvelteKit/Vite commands.

## Data Flow
- Client state lives in `src/lib/stores/grades.svelte.ts`. UI edits are optimistic and immediately call `/api/courses`, `/api/components`, and `/api/sub-items`.
- Keep the store and API field names in sync when changing component/sub-item persistence. Most edits are fire-and-forget fetches with no rollback.
- Persistence logic is in `src/lib/server/db.ts` using `better-sqlite3`; `data/tracksem.db` is created automatically from `process.cwd()` on first server-side DB access.
- Curriculum/catalog data is in `src/lib/data/courses.ts`. `seedByBranch()` merges `SEM_DATA` course metadata with `DEFAULT_COURSES` component templates by matching course `id`; if IDs drift, seeded courses silently lose their detailed component breakdown.

## Working Notes
- Do not edit `.svelte-kit/`, `.wrangler/`, or `data/tracksem.db`; they are generated/local artifacts.
