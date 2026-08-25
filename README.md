# Aidub

Aidub is an AI-powered video dubbing web application. This repository currently
contains:

- **Part 1: Hosted Web App Foundation** — the permanent application shell,
  design foundation and routing structure.
- **Part 2: Project Dashboard and Project Structure** — a functional project
  management layer (create, open, rename, delete) and a project workspace that
  loads real project metadata.

There is still **no** dubbing functionality: no media, transcription,
translation, voices, mixing or export. Those build on this foundation in later
parts.

## Stack

| Concern     | Choice                                       |
| ----------- | -------------------------------------------- |
| Framework   | Next.js (App Router) + React                 |
| Language    | TypeScript (strict)                          |
| Styling     | Tailwind CSS v4 with CSS-variable tokens     |
| UI kit      | shadcn/ui primitives (Radix + lucide icons)  |
| Toasts      | sonner                                       |
| Tests       | Vitest                                       |
| Hosting     | Vercel                                       |

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
```

Other commands:

```bash
npm run lint       # ESLint (eslint-config-next)
npm run typecheck  # tsc --noEmit
npm test           # Vitest unit tests (run once)
npm run test:watch # Vitest in watch mode
npm run build      # production build, includes TypeScript checking
npm start          # serve a production build locally
```

Localhost is a development environment only — it is not the deployment story.

## Production

Vercel is the intended deployment platform. The app is a standard Next.js App
Router project with no custom server, no persistent Node process, no local
filesystem usage and no environment variables required to render, so importing
the repository into Vercel and deploying the default build is all that is
needed.

Part 2's storage choice does not change this: project data lives in the
visitor's browser, so nothing is written on the server and no instance has to
stay alive between requests. Heavy AI/media processing still belongs outside the
Vercel web layer, behind the service boundaries described below.

## Routes

| Route                                | Purpose                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `/`                                  | Redirects to `/projects` (there is no marketing page)     |
| `/projects`                          | Projects dashboard: create, open, rename, delete          |
| `/projects/[projectId]`              | Redirects to the workspace's default section (`media`)    |
| `/projects/[projectId]/media`        | Media section (placeholder)                               |
| `/projects/[projectId]/transcript`   | Transcript section (placeholder)                          |
| `/projects/[projectId]/translate`    | Translate section (placeholder)                           |
| `/projects/[projectId]/voices`       | Voices section (placeholder)                              |
| `/projects/[projectId]/mix`          | Mix section (placeholder)                                 |
| `/projects/[projectId]/export`       | Export section (placeholder)                              |
| `/settings`                          | Settings placeholder                                      |

Workspace routes load the project identified by `[projectId]`. An id that does
not exist in this browser renders a "Project not found" state with a route back
to `/projects` — it never crashes, auto-creates a project or invents metadata.

## Project structure

```text
src/
├── app/                     # App Router routes only
│   ├── layout.tsx           # root layout: fonts, metadata, AppShell
│   ├── page.tsx             # redirect → /projects
│   ├── globals.css          # Tailwind + design tokens
│   ├── projects/
│   │   ├── page.tsx
│   │   └── [projectId]/
│   │       ├── layout.tsx   # shared project workspace layout
│   │       ├── page.tsx     # redirect → ./media
│   │       └── <section>/page.tsx
│   └── settings/page.tsx
├── components/
│   ├── layout/              # AppShell, PageHeader, Brand, PlaceholderBadge
│   ├── navigation/          # sidebar, top bar, primary nav, NavLink
│   ├── workspace/           # workspace header, section nav, reserved slots
│   └── ui/                  # shadcn/ui primitives
├── components/projects/     # dashboard, cards, dialogs, status badge
├── components/workspace/    # workspace provider, shell, header, section nav, slots
├── data/projects/           # ProjectRepository contract + browser-local implementation
├── hooks/                   # useProjects
├── lib/                     # navigation config, languages, dates, status, validation, cn()
├── services/                # boundary for future external processing (see README there)
└── types/                   # project + navigation domain types
```

## Architecture

### Vercel hosts the web application, not the workloads

Aidub is a hosted web service. Vercel is responsible for serving the Next.js
application: UI, navigation, routing and lightweight application/API work.

Everything expensive — FFmpeg pipelines, transcoding, waveform generation,
transcription, diarization, translation inference, TTS, voice cloning, GPU
inference and any long-running media job — is expected to run on **external
compute** (dedicated services, containers, background workers, GPU workers or
managed inference providers). None of it exists yet, and none of it may be
assumed to run inside a Vercel serverless function.

### Explicit service boundaries

Communication with that external infrastructure flows through modules in
`src/services/` (see [`src/services/README.md`](src/services/README.md)).
Components never call processing APIs directly and never embed endpoint URLs,
polling logic or media-processing assumptions. Part 1 contains no service
modules and no stand-in/mock endpoints — the first one lands with the first
real workload.

### Shared application shell

`AppShell` (`src/components/layout/app-shell.tsx`) is rendered once by the root
layout and wraps every route: sidebar on desktop, compact top bar below `lg`,
and a single `main` content region. Routes never re-implement chrome.

### Shared project workspace layout

`src/app/projects/[projectId]/layout.tsx` is the workspace shell:

```text
ProjectWorkspaceLayout
├── WorkspaceHeader              project context + return to Projects
│   └── WorkspaceSectionNav      Media · Transcript · Translate · Voices · Mix · Export
├── MediaStageSlot               reserved for the future persistent player
├── {children}                   the active workspace section
└── TimelineSlot                 reserved for the future dubbing timeline
```

This shape is intentional. Because the media stage and timeline live in the
**layout** rather than in section pages, a later part can mount a real player
and timeline there and keep playback, current time, selection and timeline
state alive while the user moves between sections. Future playback state
(`currentTime`, `duration`, `isPlaying`, `volume`, `playbackRate`,
`selectedMedia`) belongs at this level too — no state store exists yet, and the
slots today are clearly labelled, non-interactive placeholders.

Sections are real routes, so every section is deep-linkable and the browser's
back/forward behaviour works; they are never swapped via component state.

### Design tokens

`src/app/globals.css` defines the palette as CSS variables and exposes them to
Tailwind through `@theme inline`. Aidub is dark-first: the root layout sets the
`dark` class on `<html>`. Light values are defined alongside the dark ones so a
future part can add theme switching without re-authoring the palette. Use the
tokens (`bg-background`, `text-muted-foreground`, `border-border`,
`bg-primary`, `bg-destructive`, focus `ring-ring`, sidebar tokens …) instead of
hard-coded colors.

### Server and Client Components

Server Components are the default: layouts, pages and static chrome stay on the
server. Client Components are used only where Part 2 genuinely needs the
browser — `NavLink` (active route via `usePathname`), the projects dashboard and
its dialogs, and the workspace provider/shell/header — because temporary
persistence is browser-local. Section pages themselves remain Server Components,
passed through the client shell as `children`. When project storage moves to a
server-backed repository, these boundaries can shrink again.

### shadcn/ui

Configured through `components.json` (new-york style, CSS variables, `@/`
aliases). Only the primitives the app actually uses are present in
`src/components/ui/`: `alert-dialog`, `button`, `dialog`, `dropdown-menu`,
`input`, `label`, `select`, `separator`, `skeleton`, `sonner` (toasts),
`tooltip`. Add more the normal way:

```bash
npx shadcn@latest add <component>
```

## Part 2: Project Dashboard and Project Structure

Part 2 adds Aidub's first functional layer: projects. `/projects` is a working
dashboard, and the workspace loads real project metadata for `[projectId]`.

### Project data model

`src/types/project.ts` is the single definition of a project. A project is
metadata about a dubbing job — it holds no media asset data, which keeps future
media, transcript and render models independent of it.

| Field            | Type            | Notes                                              |
| ---------------- | --------------- | -------------------------------------------------- |
| `id`             | `string`        | `crypto.randomUUID()`; stable, URL-safe, immutable  |
| `name`           | `string`        | trimmed, required, max 100 characters               |
| `createdAt`      | `string`        | ISO 8601, set once on creation                      |
| `updatedAt`      | `string`        | ISO 8601, refreshed by every mutation               |
| `sourceLanguage` | `string`        | language code from `src/lib/languages.ts`           |
| `targetLanguage` | `string`        | language code, must differ from the source          |
| `status`         | `ProjectStatus` | see below                                           |

The id never changes — renaming a project keeps its id, `createdAt`, languages
and status.

### Project status model

`ProjectStatus` is `draft | processing | ready | completed | error`. **Every new
project starts as `draft`**, and Part 2 implements no status progression —
nothing moves a project out of `draft` yet. Labels and badge styling live only
in `src/lib/project-status.ts` and are rendered by `ProjectStatusBadge`; an
unrecognised value degrades to a neutral "Unknown" badge instead of crashing.

### Languages

`src/lib/languages.ts` owns the language list, `getLanguageLabel(code)` and
`formatLanguagePair(source, target)`, so the UI shows `English → Polish` rather
than `en → pl`. Languages are metadata only — nothing is translated in Part 2.

### Temporary persistence (browser-local)

Project persistence in Part 2 is **temporary development persistence**:

- it is **browser-local** (`localStorage`), under the versioned key
  `aidub.projects.v1`;
- it is **not** account-based, **not** shared, **not** cloud storage and **not**
  the future production database;
- projects created in one browser or device are invisible in another;
- clearing site data deletes them.

`localStorage` is touched in exactly one file —
`src/data/projects/local-project-repository.ts`. Stored data is never trusted:
records are validated on read, structurally invalid entries are dropped, an
unreadable value falls back to an empty list, and a record with an unrecognised
status keeps its data and falls back to `draft`. Corrupt development data cannot
crash the app.

### Repository abstraction

The UI consumes a `ProjectRepository`
(`src/data/projects/project-repository.ts`):

```ts
interface ProjectRepository {
  list(): Promise<Project[]>;          // sorted by updatedAt, newest first
  getById(id: string): Promise<Project | null>;
  create(input: CreateProjectInput): Promise<Project>;
  update(id: string, input: UpdateProjectInput): Promise<Project>;
  delete(id: string): Promise<void>;
}
```

The repository owns ids, timestamps, the initial status, validation,
serialization and sorting. Every method is **async** even though today's
implementation is synchronous, so a database- or HTTP-backed repository drops in
without touching a single component: swap the binding in
`src/data/projects/index.ts`.

Components reach it through `useProjects()` (dashboard) and
`ProjectWorkspaceProvider` (workspace). No component may import `localStorage`,
build ids or stamp timestamps itself.

### Dashboard

`/projects` renders loading, empty, loaded and recoverable-error states; creates
projects through an accessible dialog (name + source/target language, with
validation for empty, whitespace-only, over-long names and identical language
pairs); renames and deletes through the card's action menu, with a destructive
confirmation for delete; sorts by `updatedAt` descending; and confirms each
mutation with a toast. Creating a project navigates straight to
`/projects/[projectId]/media`.

### Workspace

`ProjectWorkspaceProvider` resolves `[projectId]` **once** for the whole
workspace and exposes `project`, `isLoading` and `error`. Section pages never
load the project themselves, and "Project not found" is only shown after loading
finishes. The workspace header shows the real project name, language pair and
status.

## Not implemented (on purpose)

Authentication, accounts, billing, a production database, file uploads, media
storage, FFmpeg/transcoding, waveform generation, background jobs, queues,
workers, transcription, diarization, translation, LLM integration, TTS, voice
cloning, media playback, the dubbing timeline, export/render processing,
analytics and collaboration are all still out of scope. There are no placeholder
or mock API routes for them; the app ships with no `app/api` directory at all.
Project persistence exists only in the temporary browser-local form described
above.

## Architectural decisions later parts must preserve

1. Next.js **App Router** is the application framework.
2. **TypeScript** is required; avoid `any`.
3. **Tailwind CSS** with the token system in `globals.css` is the styling
   foundation — no scattered hard-coded colors.
4. **shadcn/ui** provides the reusable UI primitives, kept in
   `src/components/ui/`.
5. **Vercel** hosts the Aidub web application.
6. Heavy AI/media processing is **never** assumed to run inside Vercel
   functions.
7. External processing infrastructure is reached only through explicit
   service modules in `src/services/`.
8. Project workspace pages share the common layout at
   `/projects/[projectId]`.
9. That layout must keep accommodating a **persistent** video player and
   dubbing timeline — do not move those responsibilities into section pages.
10. Workspace sections stay **route-based and deep-linkable**.
11. **Server Components** remain the default; client boundaries stay small.
12. Functionality is introduced **incrementally** — no premature scaffolding,
    mock backends or speculative abstractions.

Part 2 adds:

13. Projects have **immutable, stable ids**; renaming never changes an id.
14. Project metadata has a **typed domain model** (`src/types/project.ts`), kept
    separate from future media asset data.
15. **All** project persistence goes through the repository abstraction; React
    components never touch `localStorage` (or any future storage) directly.
16. The browser-local repository is **intentionally replaceable** — a real
    database must be introducible without rebuilding the project UI.
17. Project URLs stay `/projects/[projectId]/...`, with **Media as the default
    section**.
18. Project resolution happens **once**, at the shared workspace level; future
    player and timeline state belongs there too, never in section pages.
