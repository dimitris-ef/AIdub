# Aidub

Aidub is an AI-powered video dubbing web application. This repository currently
contains:

- **Part 1: Hosted Web App Foundation** — the permanent application shell,
  design foundation and routing structure.
- **Part 2: Project Dashboard and Project Structure** — a functional project
  management layer (create, open, rename, delete) and a project workspace that
  loads real project metadata.
- **Part 3: Video Upload and Project Media** — importing, validating,
  inspecting, previewing, replacing and removing a project's source video.
- **Part 4: Backend Media-Processing Foundation** — a server-side processing
  job pipeline (FFprobe inspection and canonical audio extraction) that later
  AI stages will run through.

There is still **no** dubbing functionality: no transcription, diarization,
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
| Media tools | FFmpeg + FFprobe, behind a backend adapter   |
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

### FFmpeg for local processing

Part 4's processing jobs shell out to FFmpeg and FFprobe. `npm install` brings
in `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` as
devDependencies, so a local checkout works with no extra setup. The binaries
are resolved at runtime in this order:

1. `FFMPEG_PATH` / `FFPROBE_PATH` environment variables
2. the installer packages above
3. `ffmpeg` / `ffprobe` on `PATH`

Nothing is hard-coded to a machine-specific path, and no build step requires
the binaries. When neither is available the app still runs: the processing API
reports the capability as unavailable and the Media workspace explains that
media jobs cannot run, instead of failing job by job.

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
| `/projects/[projectId]/media`        | Media section — source video import, preview, replace     |
| `/projects/[projectId]/transcript`   | Transcript section (placeholder)                          |
| `/projects/[projectId]/translate`    | Translate section (placeholder)                           |
| `/projects/[projectId]/voices`       | Voices section (placeholder)                              |
| `/projects/[projectId]/mix`          | Mix section (placeholder)                                 |
| `/projects/[projectId]/export`       | Export section (placeholder)                              |
| `/settings`                          | Settings placeholder                                      |

Processing API (Node runtime, see Part 4):

| Route                                       | Purpose                                     |
| ------------------------------------------- | ------------------------------------------- |
| `POST /api/processing/jobs`                 | Create a processing job                      |
| `GET /api/processing/jobs`                  | Job history for a project / source media     |
| `DELETE /api/processing/jobs`               | Cancel + purge a project's or media's jobs   |
| `GET /api/processing/jobs/[jobId]`          | Read one job (scoped to its project)         |
| `POST /api/processing/jobs/[jobId]/cancel`  | Cancel a queued or running job               |
| `GET /api/processing/artifacts/[artifactId]`| Download a generated artifact                |
| `GET /api/processing/capabilities`          | Whether FFmpeg/FFprobe are available         |

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
├── components/media/        # media workspace, picker, player, details, dialogs
├── components/workspace/    # workspace provider, shell, header, section nav, slots
├── data/projects/           # ProjectRepository contract + browser-local implementation
├── data/media/              # MediaStorage contract + IndexedDB implementation
├── server/processing/       # job service, MediaProcessor, FFmpeg adapter, temp files
├── server/artifacts/        # generated-artifact storage
├── app/api/processing/      # processing job + artifact routes (Node runtime)
├── components/processing/   # job panel, status badge, progress, results
├── services/                # application services + processing client
├── hooks/                   # useProjects, useSourceMedia
├── lib/                     # navigation, languages, dates, status, validation, cn()
├── lib/media/               # container detection, validation, metadata, formatters
└── types/                   # project, media and navigation domain types
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
| `sourceMediaId`  | `string \| null` | added in Part 3: reference to the source video      |

The id never changes — renaming a project keeps its id, `createdAt`, languages,
status and source media.

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

## Part 3: Video Upload and Project Media

Part 3 makes the Media section functional: a project can import one source
video, inspect its metadata, preview it, replace it and remove it. No media is
processed — the file is stored and played back exactly as selected.

### Media data model

`src/types/media.ts` defines `ProjectMedia`, the metadata record for one media
asset. Bytes are stored separately and are never embedded in this record or in
the project.

| Field             | Type                | Notes                                            |
| ----------------- | ------------------- | ------------------------------------------------ |
| `id`              | `string`            | `crypto.randomUUID()`; stable and immutable       |
| `projectId`       | `string`            | the owning project                                |
| `kind`            | `"video"`           | only source video exists in Part 3                |
| `filename`        | `string`            | as reported by the browser; rendered as text only |
| `mimeType`        | `string`            | may be empty when the OS reports nothing          |
| `container`       | `"MP4" \| "MOV" \| "WebM" \| null` | derived from extension + MIME     |
| `sizeBytes`       | `number`            | canonical size; formatted only for display        |
| `durationSeconds` | `number \| null`    | from browser metadata                             |
| `width`/`height`  | `number \| null`    | from browser metadata                             |
| `createdAt`       | `string`            | ISO 8601                                          |
| `updatedAt`       | `string`            | ISO 8601                                          |

### Project relationship

A project points at its source video with `project.sourceMediaId` and nothing
more — the media record owns its own metadata, and the bytes live in the media
storage layer. This keeps project metadata small and makes the later move to a
database plus object storage a change of two implementations rather than a
rewrite.

**Migration from Part 2:** `sourceMediaId` is additive and nullable, so the
project parser defaults missing values to `null` and Part 2 records keep
working. No destructive schema change was needed, and the project storage key
stays `aidub.projects.v1`.

### Development media storage

Source video bytes are stored **in the visitor's browser** using IndexedDB
(`database "aidub"`, stores `mediaMetadata` and `mediaBlobs`, each indexed by
`projectId`). IndexedDB — not `localStorage` — because it is the only browser
store that can hold multi-gigabyte Blobs.

This is temporary development storage:

- it is **not** production cloud storage and **not** synced between browsers or
  devices;
- it is subject to browser storage quotas and eviction policies, and behaves
  differently in private/incognito windows;
- clearing site data deletes the videos (the app recovers — see below);
- nothing is uploaded anywhere: no network request carries the file.

Quota and availability failures surface as readable messages ("The browser
could not store this video locally…") instead of crashing.

### Media storage abstraction

`MediaStorage` (`src/data/media/media-storage.ts`) is the contract:
`save`, `getMetadata`, `getBlob`, `listByProject`, `delete`, `deleteByProject`.
`IndexedDbMediaStorage` is the only file in the codebase that knows IndexedDB
exists; the binding lives in `src/data/media/index.ts`. **UI never touches
IndexedDB.** A production implementation backed by signed uploads and object
storage replaces that binding without UI changes.

Above it, `ProjectMediaService`
(`src/services/media/project-media-service.ts`) coordinates the lifecycle:
validation, metadata extraction, storage writes, project updates, replacement
cleanup and status transitions. Components call the service; they never
orchestrate the repository and storage themselves.

### Import and validation

Selecting a file (picker or drag-and-drop) runs, in order:

1. **File validation** — non-empty; container recognised from the *extension*
   and the reported MIME type together, since either can be missing or wrong.
2. **Browser metadata load** — which doubles as proof the browser can decode
   the file.
3. **Storage write**, then **project association**.

Nothing is associated with a project until validation succeeds, and a failure
after the write removes the freshly stored media so no orphan is left behind.

Errors are actionable, never raw exceptions: "This file type is not supported.
Use MP4, MOV, or WebM.", "This file is empty…", "The selected file could not be
read as a video…".

### Browser metadata, not codec inspection

`duration`, `videoWidth` and `videoHeight` come from a temporary `<video>`
element and its `loadedmetadata` event; the temporary object URL is revoked
immediately afterwards. There is no FFmpeg, no WASM demuxer and no container
parser, so Aidub reports no codec or bitrate information and shows "Unknown"
rather than guessing.

### Container vs codec

MP4/MOV/WebM support means Aidub **accepts those containers**. Whether a file
actually plays depends on the codecs inside it and on the browser: a `.mov`
carrying ProRes, or an MP4 carrying H.265, may be unplayable in a browser that
decodes neither, and codec support differs between Chromium, Safari and
Firefox. When the browser cannot decode a stored file, the project keeps its
media and metadata and the preview area explains the situation while Replace
and Remove stay available.

### Preview

A native `<video controls>` element plays the stored blob through an ephemeral
object URL created when the media loads and revoked when it changes or the
component unmounts. Object URLs are never persisted or used as identifiers.
There is no autoplay, and no custom transport controls — Aidub's own player and
the dubbing timeline arrive with the persistent workspace player.

### Replace and remove

**Replace** validates and stores the new file *before* touching the project.
Only after the project points at the new media is the previous copy deleted, so
a failed replacement leaves the original source intact and playable. **Remove**
requires a confirmation, detaches the project first and then deletes the stored
copy; if the copy cannot be deleted, the project is still consistent and the
user is told.

### Project status behaviour

| Event                   | Status  |
| ----------------------- | ------- |
| No source media         | `draft` |
| Source media imported   | `ready` |
| Source media replaced   | `ready` |
| Source media removed    | `draft` |

`ready` means "source media exists and the project is ready for future
processing". `processing`, `completed` and `error` are reserved for the
processing pipeline that later parts introduce, so Part 3 never sets them — a
failed import leaves the project's previous valid state untouched.

### Missing media recovery

If a project references media whose metadata or bytes are gone (browser storage
cleared, quota eviction), the Media section shows a recoverable "Source video
unavailable" state offering to import a replacement or remove the reference. It
never crashes and never deletes project data on its own.

### Project deletion and media cleanup

Deleting a project goes through `deleteProjectWithMedia`
(`src/services/projects/delete-project.ts`), which purges the project's media
from storage first and then deletes the project. A cleanup failure does not
block the deletion the user asked for; it is reported instead.

### Future processing boundary

`src/services/media/media-processing.ts` documented where processing would
connect; Part 4 implements that boundary as real processing jobs (see below).
The rule it established still holds: jobs reference stable `projectId` and
`mediaId` values, and in production a worker reads the bytes from object
storage rather than from the browser.

### Vercel

Vercel hosts the Aidub web application. Large permanent video assets will never
live in the deployment filesystem, and Part 3 writes nothing on the server:
source videos stay in the visitor's browser. Production media will live in
object storage behind a media backend, and heavy processing will run on
external workers outside the lightweight Vercel web layer.

## Part 4: Backend Media-Processing Foundation

Part 4 adds the first real server-side processing layer. It does not dub
anything: it establishes the job pipeline, the FFmpeg boundary and the artifact
model that transcription, diarization, translation, speech synthesis and
rendering will all run through later.

The layering is strict:

```text
Media workspace UI
  → ProcessingClient            (frontend contract: jobs, never commands)
    → /api/processing/*         (Node runtime route handlers)
      → ProcessingService       (validation, lifecycle, progress, cleanup)
        → MediaProcessor        (probe / extractAudio / convert)
          → FfmpegMediaProcessor (the only file that knows FFmpeg exists)
            → job-scoped temporary files
```

Nothing above `FfmpegMediaProcessor` builds a command line, spawns a process,
knows a binary path or touches a temp directory — and nothing below the client
knows whether the work ran in this process, on a worker, or on another machine.

### Processing job model

`src/types/processing-job.ts`:

| Field           | Type                    | Notes                                       |
| --------------- | ----------------------- | ------------------------------------------- |
| `id`            | `string`                | stable job id                                |
| `projectId`     | `string`                | every job belongs to a project               |
| `sourceMediaId` | `string`                | and to the exact media it processed          |
| `type`          | `ProcessingJobType`     | `probe_media` · `extract_audio` · `convert_media` |
| `status`        | `ProcessingJobStatus`   | see the lifecycle below                      |
| `progress`      | `number`                | normalised 0–100                             |
| `indeterminate` | `boolean`               | true when no real percentage is available    |
| `createdAt` / `updatedAt` | `string`      | ISO 8601                                     |
| `startedAt` / `completedAt` | `string \| null` | ISO 8601, set on start and on any terminal state |
| `error`         | `ProcessingJobError \| null` | `{ code, message, details? }`          |
| `result`        | `ProcessingJobResult`   | typed per job type, or null                  |

### Job types

- **`probe_media`** — FFprobe inspection of the source; result is
  `{ kind: "probe_media", metadata }` with container, duration, video codec /
  resolution / frame rate and audio codec / sample rate / channels. Anything
  the file does not expose is `null`, never a guess.
- **`extract_audio`** — canonical audio extraction; result is
  `{ kind: "extract_audio", artifact }`.
- **`convert_media`** — the internal conversion primitive future stages reuse
  (currently "normalise to canonical audio"). It is not a user-facing
  transcoder.

Future AI job types (transcribe, diarize, translate, synthesise, dub) are
**documented intentions only** — none are implemented or stubbed.

### Status lifecycle

```text
queued → processing → completed
queued → processing → failed
queued → cancelled            (never started)
queued → processing → cancelled
```

Terminal states are final: `completed → processing` or `failed → completed`
are rejected by the repository. A retry is a new job.

Progress follows one policy for every job type: `queued` is 0, `processing` is
1–99 and never moves backwards, `completed` is 100, and `failed`/`cancelled`
keep the last meaningful value. Extraction and conversion derive real progress
from FFmpeg's machine-readable `-progress pipe:1` output against the probed
duration; probing reports `indeterminate` instead of inventing a percentage.

### Errors

Failures are structured (`FFMPEG_NOT_AVAILABLE`, `SOURCE_MEDIA_NOT_FOUND`,
`PROBE_FAILED`, `NO_AUDIO_STREAM`, `AUDIO_EXTRACTION_FAILED`,
`CONVERSION_FAILED`, `TEMP_STORAGE_ERROR`, `CANCELLED`, …) with a short,
actionable message. FFmpeg's full output stays in the server log; only a
three-line, **path-redacted** summary is retained in `details`, so backend
filesystem paths never reach the browser. Unexpected exceptions collapse to a
generic message rather than leaking internals.

### FFmpeg and FFprobe

`FfmpegMediaProcessor` spawns binaries with **argument arrays** (never a shell
string), so a filename can never be interpolated into a command. It parses
FFprobe's JSON output (not human-readable console text), reads progress from
`-progress pipe:1`, terminates children with `SIGTERM` and escalates to
`SIGKILL` on cancellation, applies a timeout to probing, and exposes a cached
capability/version check rather than probing the binaries per job.

### Temporary files

Each job gets `<os temp>/aidub/jobs/<jobId>/`, containing a backend-named
`source.<ext>` (the user's filename never becomes a path) and any generated
output. `TemporaryFileManager` owns all of it — no `os.tmpdir()`, `mkdir` or
`rm` calls are scattered through processing code, and job ids and filenames are
validated so nothing can escape the directory.

Cleanup runs in a `finally` after **success, failure and cancellation**. A
cleanup failure is logged and never turns a successful job into a failed one;
nothing project-critical lives there, because artifacts are copied out first.
Temporary files are never project storage, and never live under `public/` or
in the repository.

### Extracted audio format

Extraction produces **WAV, mono, 16 kHz, PCM signed 16-bit little-endian**
(`-map 0:a:0 -ac 1 -ar 16000 -c:a pcm_s16le`). That is the format speech
systems — transcription and diarization especially — consume without
resampling, it is lossless relative to what those models actually use, and it
keeps artifacts small. It is a deliberate default for the speech pipeline, not
a claim that every future stage wants it: a stage needing stereo or a higher
rate re-derives it from the source rather than upsampling this artifact.

If the source has no audio track, the job **fails** with `NO_AUDIO_STREAM` and
the message "No audio track was found in this source video." — no empty file is
produced and no job is falsely marked complete.

### Processing artifacts

Generated output is a `ProcessingArtifact` (id, project, source media, job,
type, filename, mime type, size, sample rate, channels, duration, createdAt) —
deliberately separate from Part 3's source media and from project metadata.
Source video belongs to the project; artifacts belong to the job that produced
them.

`ProcessingArtifactStorage` is the boundary. The development implementation
keeps metadata in the server process and bytes under
`<os temp>/aidub/artifacts/<artifactId>/`, outside the job directories so they
survive job cleanup, and serves them through
`GET /api/processing/artifacts/[artifactId]`. This is **development storage**:
it does not survive a server restart or temp reclamation, and production
replaces it with object storage behind the same interface.

### Development job persistence

Jobs live in an in-process store (`InMemoryProcessingJobRepository`). Job
history is therefore lost when the server restarts and is not shared between
server instances — acceptable for local development, and replaced by a
database- or queue-backed `ProcessingJobRepository` in production without
touching the API contract or the UI.

### Development source transport

Part 3 keeps source video in the browser, which server code cannot read, so a
job request carries the bytes as a multipart `source` part. This is a
**development transport, not the storage architecture**: the uploaded bytes are
written into the job's temp directory, used, and deleted with it — nothing is
persisted server-side. In production the backend resolves `sourceMediaId` to
object storage (or a signed URL) and the browser sends no bytes at all; the job
model, API contract and UI are unchanged by that switch.

The development upload ceiling is 512 MB (`PROCESSING_MAX_UPLOAD_BYTES`).
Platform request-body limits — Vercel functions cap uploads at a few MB — are
precisely why routing source media through the web app is temporary.

### Frontend contract

The Media workspace talks to `ProcessingClient` (`src/services/processing/`),
never to `fetch` directly and never to FFmpeg. It creates jobs, reads them, and
cancels them; `useProcessingJobs` polls active jobs every 1.5 s with a chained
timeout (so requests never overlap), stops on any terminal state and on
unmount, and swallows transient network errors instead of failing the job. A
future realtime transport replaces the polling inside that hook without
changing what the UI renders.

### Media workspace integration

With a valid source video the Media section shows a compact **Processing**
panel: *Inspect source* and *Extract audio* actions (disabled while a job is
being created, and when the backend reports FFmpeg unavailable), plus recent
jobs for the **current** source media, newest first — with status badge,
progress, cancel action while queued or running, concise failure message,
server-derived probe metadata and a downloadable artifact summary
("WAV · Mono · 16 kHz · 00:03 · 96.1 KB").

### Project status is not job status

Part 3's semantics are untouched: no source media → `draft`, source present →
`ready`. Processing state lives in `ProcessingJob.status` alone; a failed probe
never marks the project itself as errored.

### Source replacement, removal and project deletion

Jobs stay associated with the media id they processed, so replacing a source
starts a fresh (empty) job list for the new media while the old jobs remain
historical records. Replacing or removing a source cancels anything still
running for the old media and drops its generated artifacts; deleting a project
cancels its jobs, purges its artifacts and its job history, and then deletes the
project. All of it is coordinated in the service layer, never in components.

### Production worker architecture

The development implementation runs jobs in the web server process. That is a
convenience, **not the production model**:

```text
Browser
  → Vercel-hosted Aidub web app
    → processing API / job coordinator
      → external queue → worker infrastructure
        → FFmpeg / GPU AI workers
          → object storage
```

Long-running FFmpeg and AI work is **not** intended to run inside Vercel
serverless functions: they are time- and size-limited, and heavy media work
belongs on dedicated compute. Moving execution out means replacing "run it
here" with "enqueue it" inside `ProcessingService`, and swapping the job
repository, artifact storage and media source for production implementations —
`ProcessingJob`, the HTTP contract, the client and the workspace UI stay as
they are. Nothing in the web build depends on FFmpeg being present: the
binaries are resolved at runtime, and a deployment without them simply reports
processing as unavailable.

## Not implemented (on purpose)

Authentication, accounts, billing, a production database, cloud media storage,
transcoding for delivery, proxy or thumbnail generation, waveform generation,
real queues and external workers, transcription, diarization, source separation,
translation, LLM integration, TTS, voice cloning, the persistent workspace
player, the dubbing timeline, export/render processing, analytics and
collaboration are all still out of scope. Part 4 stops at media processing and
artifact production: the extracted audio is not sent to any AI provider. There are no placeholder or mock API
routes for them; the app ships with no `app/api` directory at all. Project and
media persistence exist only in the temporary browser-local forms described
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

Part 3 adds:

19. A project has **at most one primary source video** for now.
20. Projects reference media by **stable media id**; binary media is never
    embedded in project metadata, and media metadata is kept separate from the
    bytes.
21. **UI never accesses IndexedDB** (or any storage) directly — all media
    persistence goes through the `MediaStorage` abstraction, and all
    project/media coordination through the service layer.
22. Development media persistence is **temporary and replaceable**; production
    media will live in external object storage behind a backend.
23. Large media must **never** depend on Vercel deployment filesystem
    persistence, and heavy processing stays outside the Vercel web layer.
24. **Media validation happens before** any project association changes.
25. **Replacement preserves the old source** until the new one commits
    successfully.
26. Object URLs are **ephemeral** and must never be persisted as identifiers.
27. Browser metadata extraction is **not** codec inspection — no FFmpeg, no
    container parsing.
28. Future processing jobs reference stable `projectId` and `mediaId`.
29. Deleting a project **cleans up its media**; renaming a project **never**
    touches the media association.

Part 4 adds:

30. The frontend interacts with **processing jobs**, never with FFmpeg
    commands, process ids or backend paths.
31. FFmpeg/FFprobe usage stays isolated behind `MediaProcessor`; only its
    adapter knows binary paths, flags, exit codes and signals.
32. Jobs have stable ids and a typed lifecycle; terminal states are final.
33. Every job belongs to a `projectId` **and** a `sourceMediaId`, and is only
    readable through its own project.
34. Storage and processing stay separate; generated artifacts are separate from
    project metadata and from source media.
35. Temporary files are job-scoped and cleaned after success, failure and
    cancellation; backend paths are never exposed to the frontend.
36. Untrusted filenames are never shell-interpolated and never become paths.
37. The browser→backend source upload is a **development transport**;
    production resolves source media from object storage.
38. The job API contract must stay stable when execution moves to external
    workers, and the job model must remain usable with a queue.
39. Project status is not a substitute for job status.
40. Long-running processing is never permanently tied to Vercel functions, and
    FFmpeg runs only in a Node server environment.
41. Replacing a source creates a new media identity; jobs stay attached to the
    media they processed.
42. Future transcription and AI stages consume processing artifacts through
    this same job architecture.
