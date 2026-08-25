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
- All project persistence goes through the `ProjectRepository` abstraction in
  `src/data/projects/`. No component may touch `localStorage`, mint project ids
  or stamp timestamps — the repository owns that. Its browser-local
  implementation is temporary and must stay swappable for a database.
- Project ids are immutable: renaming changes the name and `updatedAt` only.
- `ProjectWorkspaceProvider` resolves `[projectId]` once for the whole
  workspace; section pages read context instead of loading the project.
- Media bytes go through the `MediaStorage` abstraction in `src/data/media/`;
  no component may touch IndexedDB, and no video bytes may be put in
  localStorage, the repo, `public/`, or any server filesystem.
- Project/media coordination (import, replace, remove, cleanup on project
  delete) belongs to the services in `src/services/`, not to components.
- Media validation runs before any project association changes, and a
  replacement keeps the old source until the new one commits.
- Object URLs are ephemeral: revoke them, never persist them as identifiers.
- FFmpeg/FFprobe live behind `MediaProcessor` in `src/server/processing/`.
  No component, hook, API route or service may spawn processes, build command
  strings, know binary paths or touch temp directories.
- Server-side processing modules stay under `src/server/` (guarded by
  `server-only`) and run on the Node runtime, never Edge.
- The frontend talks to processing through `ProcessingClient` and the job
  contract only; job ids, project ids and media ids are the currency, never
  paths or process ids.
- Temporary files are job-scoped and cleaned in a `finally`; backend paths and
  raw FFmpeg output never reach the UI.
- The multipart source upload is a development transport — production resolves
  `sourceMediaId` from object storage. Keep the job model transport-agnostic.
- Long-running media/AI work must stay movable to external workers: no queue
  yet, but no assumptions that jobs run inside the web process either.
- Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` before
  calling work done.
