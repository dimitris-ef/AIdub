<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Aidub

Read `README.md` before changing anything — in particular **Architecture** and
**Architectural decisions later parts must preserve**.

Non-negotiables for new work:

- Heavy media/AI processing does not run in Vercel functions; it lives behind
  service modules in `src/services/`.
- The project workspace layout at `src/app/projects/[projectId]/layout.tsx`
  owns the future persistent player and timeline. Do not move that into
  individual section pages, and do not break the shared layout.
- Workspace sections are routes, not component state.
- Server Components by default; add `"use client"` only where interactivity
  requires it.
- Style with the design tokens in `src/app/globals.css`, not hard-coded colors.
- Do not add mock APIs or scaffolding for features that are not being built.
