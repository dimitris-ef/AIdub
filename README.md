# Aidub

Aidub is an AI-powered video dubbing web application. This repository currently
contains **Part 1: Hosted Web App Foundation** — the permanent application
shell, design foundation and routing structure that every later part builds on.

Part 1 deliberately ships **no** dubbing functionality. What exists is the
skeleton: navigation, a dark-first design system, a projects entry point and a
project workspace whose layout is already shaped for the persistent player and
dubbing timeline that arrive later.

## Stack

| Concern     | Choice                                       |
| ----------- | -------------------------------------------- |
| Framework   | Next.js (App Router) + React                 |
| Language    | TypeScript (strict)                          |
| Styling     | Tailwind CSS v4 with CSS-variable tokens     |
| UI kit      | shadcn/ui primitives (Radix + lucide icons)  |
| Hosting     | Vercel                                       |

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
```

Other commands:

```bash
npm run lint     # ESLint (eslint-config-next)
npm run build    # production build, includes TypeScript checking
npm start        # serve a production build locally
```

Localhost is a development environment only — it is not the deployment story.

## Production

Vercel is the intended deployment platform. The app is a standard Next.js App
Router project with no custom server, no persistent Node process, no local
filesystem usage and no environment variables required to render, so importing
the repository into Vercel and deploying the default build is all that is
needed.

## Routes

| Route                                | Purpose                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `/`                                  | Redirects to `/projects` (there is no marketing page)     |
| `/projects`                          | Projects entry point — empty state foundation             |
| `/projects/[projectId]`              | Redirects to the workspace's default section (`media`)    |
| `/projects/[projectId]/media`        | Media section (placeholder)                               |
| `/projects/[projectId]/transcript`   | Transcript section (placeholder)                          |
| `/projects/[projectId]/translate`    | Translate section (placeholder)                           |
| `/projects/[projectId]/voices`       | Voices section (placeholder)                              |
| `/projects/[projectId]/mix`          | Mix section (placeholder)                                 |
| `/projects/[projectId]/export`       | Export section (placeholder)                              |
| `/settings`                          | Settings placeholder                                      |

Workspace routes render for **any** project id (e.g. `/projects/demo/media`);
there is no project storage yet, and the displayed project name is derived from
the URL rather than from saved metadata.

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
├── lib/                     # navigation config, project helpers, cn()
├── services/                # boundary for future external processing (see README there)
└── types/                   # shared types used by more than one module
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

Server Components are the default. The only client component in Part 1 is
`NavLink`, which needs `usePathname` for active state; it exposes that state via
`data-active` so server components own the styling. Keep client boundaries this
small as the app grows.

### shadcn/ui

Configured through `components.json` (new-york style, CSS variables, `@/`
aliases). Only the primitives Part 1 uses are present in
`src/components/ui/`: `button`, `separator`, `tooltip`. Add more the normal
way:

```bash
npx shadcn@latest add <component>
```

## Not implemented (on purpose)

Authentication, accounts, database, project persistence, billing, file uploads,
media storage, FFmpeg/transcoding, waveform generation, background jobs, queues,
workers, transcription, diarization, translation, LLM integration, TTS, voice
cloning, media playback, the dubbing timeline, export/render processing,
analytics and collaboration are all out of scope for Part 1. There are no
placeholder or mock API routes for them; the app ships with no `app/api`
directory at all.

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
