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
  AI stages run through.
- **Part 5: Speech-to-Text System** — provider-agnostic transcription that
  turns the source speech into persisted, timestamped segments.
- **Part 6: Speaker Diarization** — provider-agnostic speaker analysis that
  determines who spoke and when, as a separate persisted timeline.
- **Part 7: Unified Transcript + Speaker Model** — the derived dialogue model
  that combines the two into who said what, and when.
- **Part 8: Transcript & Speaker Editor** — the synchronised review workspace
  where a person corrects that dialogue, without touching the raw results.

There is still **no** dubbing functionality: no translation, voices, mixing or
export. Those build on this foundation in later parts.

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
| Speech      | Local Whisper (sherpa-onnx) or any OpenAI-compatible STT API, behind a provider adapter |
| Speakers    | Local pyannote segmentation + speaker embeddings (sherpa-onnx), behind a provider adapter |
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

### Speech models for local transcription

The default transcription provider runs a Whisper model on this machine. The
runtime (`sherpa-onnx-node`) installs with `npm install`; the model files are
downloaded separately and never committed:

```bash
npm run setup:stt   # ~100 MB into .aidub/stt-models (gitignored)
```

Without them the app still runs: the provider reports itself unavailable and
the Transcript workspace says so instead of failing mid-job. Configuration:

| Variable | Purpose |
| --- | --- |
| `AIDUB_STT_PROVIDER` | `local-whisper` (default), `openai-compatible`, or `mock` |
| `AIDUB_STT_MODEL_DIR` | Where the local model files live (default `.aidub/stt-models`) |
| `AIDUB_STT_MODEL` | Model label recorded on transcripts |
| `AIDUB_STT_API_KEY` | Credential for the remote provider — server-side only |
| `AIDUB_STT_BASE_URL` | Remote endpoint (default `https://api.openai.com/v1`) |
| `AIDUB_STT_TIMEOUT_MS` | Provider timeout (default 15 minutes) |

### Speaker models for local diarization

The default diarization provider runs pyannote segmentation and a speaker
embedding model on this machine, on CPU. It shares the `sherpa-onnx-node`
runtime with transcription; the model files are downloaded separately and never
committed:

```bash
npm run setup:diarization   # ~46 MB into .aidub/diarization-models (gitignored)
```

Both models are public ONNX exports served from a GitHub release: **no Hugging
Face account, no access token, no GPU and no Python are required.** Without
them the app still runs: the provider reports itself unavailable and the
Speaker Analysis panel says so instead of failing mid-job. Configuration:

| Variable | Purpose |
| --- | --- |
| `AIDUB_DIARIZATION_PROVIDER` | `local-pyannote` (default) or `mock` |
| `AIDUB_DIARIZATION_MODEL_DIR` | Where the local model files live (default `.aidub/diarization-models`) |
| `AIDUB_DIARIZATION_MODEL` | Model label recorded on results |
| `AIDUB_DIARIZATION_CLUSTER_THRESHOLD` | Clustering distance (default `0.8`); higher merges more voices |
| `AIDUB_DIARIZATION_TIMEOUT_MS` | Provider timeout (default 30 minutes) |

A provider that needs a credential — a hosted diarization API, a Hugging Face
gated model — reads it from a server-side variable inside its own adapter.
Credentials are never `NEXT_PUBLIC_*`, never reach a Client Component, and are
never written into a persisted result.

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
| `/projects/[projectId]/transcript`   | Transcript section — transcribe, run speaker analysis, and review and correct the dialogue |
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
| `GET /api/transcripts`                      | The stored transcript for a project + source |
| `GET /api/diarizations`                     | The stored speaker analysis for a project + source |
| `GET /api/dialogue`                         | The unified dialogue for a project + source (generated lazily) |
| `PATCH /api/dialogue`                       | Applies one human correction to the stored dialogue |

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
├── server/transcription/    # transcription service, STT provider contract + adapters
├── server/diarization/      # diarization service, speaker provider contract + adapters
│                            #   (model runs on a worker thread, off the request path)
├── server/artifacts/        # generated-artifact storage
├── data/transcripts/        # TranscriptRepository + development store
├── data/diarization/        # DiarizationRepository + development store
├── server/dialogue/         # dialogue service: prerequisites, staleness, regeneration
├── data/dialogue/           # UnifiedDialogueRepository + development store
├── lib/dialogue/            # interval math, merge algorithm, thresholds,
│                            #   staleness, edit operations, validation
├── components/dialogue/     # assignment and overlap badges
├── components/player/       # project video player, wired to shared playback state
├── components/timeline/     # dialogue timeline, playhead, resize handles
├── components/transcript/   # transcript workspace, segment rows, status
├── components/diarization/  # speaker analysis panel, summary, region list
├── lib/diarization/         # speaker-id assignment and region normalisation
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

## Part 5: Speech-to-Text System

Part 5 answers one question — **what was said, and when** — and stores the
answer. It does not say *who* said it: diarization is a later part, and there
are no speaker fields in the model.

```text
Transcript workspace
  → ProcessingClient ("transcribe" job)   the UI's only backend contact
    → ProcessingService                    job lifecycle, temp workspace
      → TranscriptionService               orchestration, normalisation
        → SpeechToTextProvider             local model, remote API, worker…
          → normalised result
        → TranscriptRepository             persisted transcript
```

The workspace never learns which model ran, where it ran, or what the provider's
JSON looked like.

### Provider abstraction

`SpeechToTextProvider` (`src/server/transcription/speech-to-text-provider.ts`)
takes audio (a path or bytes) plus an optional language hint and returns
normalised segments, with a `capabilities` block describing what it can
actually do (language hints, segment/word timestamps, real confidence). It is
deliberately not HTTP-shaped, so a local model, a self-hosted server and a
remote API all fit — and a GPU worker later fits the same way. Providers are
registered in one place
(`speech-to-text-provider-registry.ts`); the default comes from
`AIDUB_STT_PROVIDER`, so a future Settings page can choose one without touching
transcription code.

### Providers implemented

- **`local-whisper` (default)** — fully local and self-hosted. Silero VAD splits
  the canonical 16 kHz mono WAV into speech regions and a Whisper model
  (`whisper-tiny.en` by default, via `sherpa-onnx-node`) transcribes each one,
  so segment times come from the audio itself. No credentials, no network, no
  data leaving the machine. Requires `npm run setup:stt`; without the model
  files it reports itself unavailable. Limitations: an English tiny model by
  default, CPU-bound, and no language hint or calibrated confidence — Whisper's
  token log probabilities are kept as provider metadata instead of being
  reshaped into a confidence score.
- **`openai-compatible`** — the widely implemented
  `POST /audio/transcriptions` shape (OpenAI's endpoint and the self-hosted
  servers that copy it). Credentials come from `AIDUB_STT_API_KEY` on the
  server only: they are never bundled, never sent to the browser, never stored
  in a transcript and never logged.
- **`mock`** — deterministic, for tests and offline development. It is only
  registered when `AIDUB_STT_PROVIDER=mock` is set explicitly, so it can never
  become a silent production default.

### Transcript model

`src/types/transcript.ts`:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | stable transcript id |
| `projectId` | `string` | owning project |
| `sourceMediaId` | `string` | the exact source version transcribed |
| `audioArtifactId` | `string \| null` | the Part 4 audio artifact used |
| `providerId` / `providerModel` | `string` / `string \| null` | which provider and model produced it |
| `language` | `string \| null` | detected/confirmed language; never written back to the project |
| `status` | `processing \| completed \| failed` | see below |
| `segments` | `TranscriptSegment[]` | timeline-ordered |
| `createdAt` / `updatedAt` | `string` | ISO 8601 |

### Segment model

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | stable; speakers, translations and generated audio will hang off it |
| `startTime` / `endTime` | `number` | **seconds**, the canonical unit everywhere |
| `originalText` | `string` | the original-language transcription; translation must never overwrite it |
| `status` | `completed \| low_confidence` | |
| `confidence` | `number \| null` | normalised 0–1, or null — never invented |
| `providerMetadata` | `Record<string, unknown>` | model name, average log probability, no-speech probability… never raw dumps, never secrets |

Timestamps are stored as numbers and formatted only for display
(`00:03.240`, `1:02:14.820`).

### Transcript status vs job status

`ProcessingJob.status` owns execution (`queued → processing → completed |
failed | cancelled`); `Transcript.status` describes the stored artefact and is
`completed` for everything that gets persisted. A transcript is only written
once its segments have been normalised and validated, so a failed or cancelled
job leaves no transcript at all. The project's own status stays as Part 3
defined it (`draft`/`ready`) — a failed transcription never marks the project
itself as errored.

### Normalisation and validation

Provider output goes through one pure step
(`src/lib/transcript/normalize-transcript.ts`) before anything is stored:

- text is trimmed but otherwise left exactly as the provider wrote it —
  capitalisation, punctuation and wording are never rewritten;
- blank and whitespace-only segments are dropped; timestamps are never moved to
  close the gaps they leave;
- every segment must have finite timestamps with `startTime >= 0` and
  `endTime >= startTime`; violations fail the job with
  `STT_TIMESTAMP_INVALID` rather than entering the transcript;
- sub-50 ms negative starts and sub-second overshoot past the media duration
  are treated as rounding and clamped; anything larger is rejected;
- segments are sorted by start time. **Overlaps are allowed** — recognisers
  legitimately produce them and the timeline will handle them explicitly;
- confidence is kept only when it is already comparable on a 0–1 scale;
  anything else becomes `null` and stays in provider metadata;
- stable ids are generated per segment — never array positions.

Zero segments from a provider that clearly heard nothing is a **valid empty
transcript**, and the workspace says "No speech was detected in this source."
That is distinct from a malformed response, which fails with
`STT_INVALID_RESPONSE`.

### Audio dependency

Transcription consumes Part 4's canonical audio artifact (WAV, mono, 16 kHz,
PCM s16le) and never runs FFmpeg itself. When the user starts transcription the
processing layer looks for an existing `extracted_audio` artifact for **this**
project and **this** source media whose bytes are still present; it reuses that
one, and only extracts when there is none (or the bytes are gone). The user
never has to press "Extract audio" first, and the same audio is not extracted
twice.

### Job integration and progress

Transcription is a `transcribe` processing job — the same model, API and status
UI as Part 4, not a second AI-job system. Jobs carry `projectId`,
`sourceMediaId`, the `providerId` used, and the `audioArtifactId` once known,
and the result references the saved transcript rather than repeating it:

```ts
{ kind: "transcribe", transcriptId, segmentCount, detectedLanguage, providerId, providerModel }
```

Progress maps to one documented scale: 1–10 preparing, 10–30 extracting audio
when needed, 30–90 provider work (real percentages when the provider reports
them), 95 saving, 100 done, with a stage label such as "Recognising speech".

### Persistence

Transcripts are stored server-side as JSON under
`<os temp>/aidub/transcripts/v1/<projectId>/<transcriptId>.json`, behind
`TranscriptRepository`. The server owns this store because it is the only place
that can guarantee a transcript is written *after* validation succeeds. The
`v1` path segment is the schema version: adding speakers, translations, edits or
word timestamps later means writing `v2` and migrating on read, not discarding
existing transcripts.

This is development persistence — local to one machine and subject to temp
reclamation. Production replaces it with a database behind the same interface;
the workspace, which reads through `TranscriptClient`, does not change.

### Source association

A transcript belongs to one project **and** one exact `sourceMediaId`. Replacing
the source video creates a new media identity, so the old transcript stays
attached to the old source and the new one starts with "No transcript yet" —
old text is never silently carried over. Removing the source, or deleting the
project, disposes of the associated transcripts through the same cleanup path
that handles media and artifacts. Renaming a project changes nothing about
transcripts.

### Reuse, retranscription, cancellation and errors

Opening the workspace loads the stored transcript for the current source and
never starts work on its own. Retranscription is explicit: the new transcript is
saved first and only then does the previous one go. Cancelling stops the
provider, leaves the job `cancelled`, and saves nothing — a result that arrives
after cancellation is discarded. Failures are normalised
(`STT_PROVIDER_UNAVAILABLE`, `STT_AUTHENTICATION_FAILED`, `STT_REQUEST_FAILED`,
`STT_TIMEOUT`, `STT_INVALID_RESPONSE`, `STT_TIMESTAMP_INVALID`,
`STT_UNSUPPORTED_AUDIO`, `AUDIO_ARTIFACT_MISSING`, `AUDIO_EXTRACTION_FAILED`,
`TRANSCRIPT_SAVE_FAILED`) and shown as one short sentence, with retry available;
technical detail stays in server logs, which record ids, provider, model,
segment counts and durations — never audio, transcripts or credentials.

### Production architecture

```text
Browser (Vercel-hosted Aidub)
  → processing/job API
    → queue / job coordinator
      → transcription worker (CPU or GPU)
        → SpeechToTextProvider (local model or external API)
          → transcript persistence (database)
```

Long transcriptions are **not** intended to run inside Vercel functions. Moving
execution out means running `TranscriptionService` in the worker and swapping
the job repository, artifact storage and transcript repository for production
implementations — `ProcessingJob`, `Transcript`, the HTTP contract and the
Transcript workspace all stay as they are.

### Explicit non-goals

Part 5 does **no** diarization (no speakers, embeddings or voice identity), no
translation or LLM calls, no source separation, no TTS or voice cloning, and no
dubbing or mixing. The extracted audio is not sent to any AI provider beyond
the configured speech-to-text one.

## Part 6: Speaker Diarization

Part 6 answers one question about the source audio: **who spoke, and when?**

Part 5 already answers *what was said and when*. The two are deliberately kept
apart — they are different models, different providers and different persisted
records — and Part 7 will merge their timelines into a unified dialogue model.
Part 6 performs **anonymous speaker clustering only**.

### Diarization architecture

```text
Speaker Analysis panel (Client Component)
        ↓ ProcessingClient.createJob({ type: "diarize" })
POST /api/processing/jobs                     (Node runtime)
        ↓
ProcessingService                             (job lifecycle, temp workspace)
        ↓ ensureAudio()  ── reuses the Part 4 canonical audio artifact
DiarizationService                            (orchestration, normalisation)
        ↓
SpeakerDiarizationProvider                    (the only provider-aware layer)
  ├── local-pyannote  (self-hosted, CPU, default)
  └── mock            (deterministic, development only)
        ↓ normalised speaker regions
DiarizationRepository                         (persisted result)
        ↓
GET /api/diarizations → DiarizationClient → useDiarization → panel
```

Nothing above the provider adapter knows which model is used, whether it runs
locally or remotely, whether a GPU is involved, what the vendor's response
looks like, what it calls its speakers, or how it authenticates.

### Provider abstraction

```ts
interface SpeakerDiarizationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: SpeakerDiarizationProviderCapabilities;
  isAvailable(): Promise<boolean>;
  diarize(
    input: SpeakerDiarizationInput,
    context?: SpeakerDiarizationContext,
  ): Promise<SpeakerDiarizationResult>;
}
```

Audio arrives as a path **or** bytes, so a provider is never forced to read a
filesystem. The context carries an `AbortSignal` and an `onProgress` callback,
which is how cancellation and progress reach a provider without it knowing
anything about processing jobs. Capabilities (`supportsKnownSpeakerCount`,
`supportsSpeakerRange`, `supportsOverlappingSpeech`, `reportsConfidence`) exist
so provider-specific behaviour never leaks upward.

This is a **separate abstraction from `SpeechToTextProvider`**, on purpose.
Even a vendor whose API transcribes and diarizes in one request is adapted as
two application-level providers, so Aidub can always pair STT provider A with
diarization provider B.

`speaker-diarization-provider-registry.ts` resolves the active provider from
`AIDUB_DIARIZATION_PROVIDER`; the provider name is not hard-coded anywhere else.

### Initial provider

`local-pyannote` runs entirely on this machine, on CPU:

- **Segmentation** — pyannote/segmentation-3.0 (MIT), ONNX export, finds speech
  turns.
- **Embeddings** — NeMo TitaNet-small, one vector per turn.
- **Clustering** — agglomerative clustering groups turns into speakers.

Setup is `npm run setup:diarization`; see *Speaker models for local
diarization* above. No Hugging Face token, no API key, no GPU, no Python.

The analysis runs on a **worker thread**, not the request thread. It is a
single blocking native call; on the main thread it stalls the Node event loop
for seconds, during which the web process serves nothing — not even the cancel
the user just clicked. Measured on the bundled 57 s fixture, moving it
off-thread took the worst unrelated-request latency from ~3.4 s to ~16 ms.
That worker boundary is also the seam a remote CPU/GPU worker slots into.

Known limitations, stated rather than hidden:

- **Speaker-count inference is not perfect.** The number of clusters comes from
  a distance threshold (`AIDUB_DIARIZATION_CLUSTER_THRESHOLD`, default `0.8`,
  tuned against the bundled multi-speaker fixture). Similar voices can merge and
  one person recorded across changing conditions can split. Part 6 provides no
  manual correction tooling; the result, the speaker count and the provider
  metadata are stored as produced.
- **No confidence.** Clustering distances are not calibrated probabilities, so
  every `confidence` is `null` and nothing is invented.
- **No provider-reported overlap.** The binding returns a flat turn list, so
  `supportsOverlappingSpeech` is `false`. Overlap is still *representable*, and
  the normaliser derives it where two different speakers demonstrably share time.
- **In-process execution is a development path**, not the production
  architecture (see below). It runs off the request thread, but it still runs
  on the web machine and competes with it for CPU.

### Speaker model

```ts
interface DiarizedSpeaker {
  id: string;                // speaker_1, speaker_2, …
  label: string;             // "Speaker 1"
  confidence: number | null;
  providerMetadata?: Record<string, unknown>;  // { rawSpeakerLabel: "cluster_3" }
}
```

`speaker_1`, `speaker_2`, … are **anonymous cluster identities within the
active diarization result**. They are not people. Part 6 implements no speaker
naming, identity recognition, face recognition, voiceprint enrollment, speaker
verification or gender classification. A later part may let a user attach a name
or a voice; the model does not do it and does not guess.

### Speaker region model

```ts
interface SpeakerRegion {
  id: string;                // stable, crypto.randomUUID()
  speakerId: string;         // always a canonical speaker_N
  startTime: number;         // seconds
  endTime: number;           // seconds
  confidence: number | null;
  overlap: boolean;
  providerMetadata?: Record<string, unknown>;
}
```

Times are **numeric seconds**, the same convention as transcript segments — a
formatted string is never persisted. Region ids are stable and are never array
indexes, because Part 7 may need to reference an individual region.

### Normalisation rule

Canonical speaker ids are assigned **by first appearance on the timeline**,
never from the provider's own labels or ordering:

```text
provider:   SPEAKER_B 0–4s   SPEAKER_A 4–8s   SPEAKER_B 8–10s
normalised: speaker_1        speaker_2        speaker_1
```

The full normalisation pass, in `src/lib/diarization/normalize-diarization.ts`,
is pure and unit-tested:

- rejects a missing/empty speaker label, a non-finite time, a negative start
  beyond 50 ms of rounding noise, an end before its start, or a time well past
  the known audio duration;
- clamps an overshoot within 1 s of the audio duration;
- sorts by start time, then end time, then provider label as a deterministic
  tie-breaker;
- collapses **exact** duplicate regions only — neighbouring regions are never
  merged, and short regions are never dropped, because Part 7 benefits from the
  model's own segmentation detail;
- keeps a confidence only if it is already on a 0–1 scale, otherwise `null`;
- marks `overlap` when the provider reports it, or when two *different*
  speakers demonstrably share time.

**Silence stays a gap.** No `speaker_unknown` is invented to fill it.

An invalid result fails the job; a partially valid one is never persisted.

### Audio dependency

Diarization consumes the Part 4 canonical audio artifact (WAV, mono, 16 kHz)
and never runs FFmpeg itself. Before starting it looks for an
`extracted_audio` artifact matching this project **and** this exact
`sourceMediaId`, and verifies its bytes still exist; metadata without bytes is
treated as absent and regenerated through Part 4. Transcription and diarization
of the same source therefore share **one** extraction instead of each running
their own.

### Job integration

Diarization is a `diarize` **processing job** — the Part 4 job architecture,
not a second AI-job system. Same statuses (`queued → processing →
completed | failed | cancelled`), same progress and polling, same job-scoped
temp directory cleaned in a `finally`, same cancellation. Progress maps:

| Range | Meaning |
| --- | --- |
| 1–10 | preparing / reusing audio |
| 10–30 | extracting audio when it has to be produced |
| 30–90 | provider work (real percentage only when the provider reports one) |
| 95 | saving the result |
| 100 | completed |

The job result is a reference, never the region list:

```ts
{ kind: "diarize", diarizationId, speakerCount, regionCount, providerId, providerModel }
```

### Cancellation

Cancelling aborts the provider through the shared signal, and a result that
arrives after the abort is discarded — a cancelled job never persists a
completed diarization and never later flips to completed (the job model's
transition rules make terminal states final).

The local provider's analysis cannot be interrupted mid-flight, so
cancellation **detaches** rather than kills: the caller is freed immediately,
the job is marked cancelled, the UI stops polling, and the worker's result is
never read. Killing the worker instead is not an option — tearing down a thread
while the native addon is executing on it aborts the entire process. The cost
is that an abandoned analysis keeps using CPU until it finishes on its own.
This is a limitation of running the model in-process; it disappears once the
model runs on a real external worker. A future remote provider that cannot
recall an already-submitted job behaves the same way.

### Persistence and schema versioning

Completed results are persisted behind `DiarizationRepository` and outlive
their job. The development implementation writes versioned JSON under
`<os temp>/aidub/diarizations/v1/<projectId>/<id>.json` — the same convention as
Part 5 transcripts, and for the same reason: the pipeline runs server-side, so
the server can guarantee a result is only written after validation succeeds.

Speaker names, embeddings, manual reassignment, region edits and merge/split
metadata are expected later; adding them means writing `v2` alongside `v1` and
migrating on read, not deleting existing data. Production replaces the store
with a database behind the same interface.

### Source identity and lifecycle

A result belongs to a project, an exact `sourceMediaId` and the audio artifact
it analysed.

- **Reopening a project** reuses the stored result — same speaker ids, same
  region ids, no automatic reprocessing.
- **Replacing the source** produces a new media id, so the old result is not
  current for the new source; the panel starts empty and a new job references
  the new media and artifact. Regions are never migrated between sources.
- **Removing the source** or **deleting the project** cancels active jobs and
  cleans up the development results, through the service layer.
- **Renaming a project** changes nothing: not the diarization id, the speaker
  ids, the region ids, the source association or the provider metadata.
- **Rediarize** keeps the working result until the new run has been stored
  successfully; a failed rerun leaves the previous result usable.

**Speaker ids are stable within a result, not across runs.** `speaker_1` from a
new run is *not* promised to be the same person as `speaker_1` from an earlier
independently recomputed run. Part 7 works against the active result.

### Transcript independence

Part 6 does not touch Part 5's data. Transcript segments gain no speaker field,
their ids, text and timings are unchanged by diarization, and the Transcript
rows do not display speaker attribution. A project may have a transcript only,
a diarization only, both, or neither.

### The Part 7 boundary

```text
Part 5 → TranscriptSegment[]   (what was said, when)
Part 6 → SpeakerRegion[]       (who spoke, when)
Part 7 → merges the two
```

Part 7 can load both independently for the same `projectId` + `sourceMediaId`.
Both use numeric seconds, both arrive in timeline order, both carry stable ids,
and overlapping speech is preserved rather than flattened. **No merging is
implemented in Part 6.**

### Production worker architecture

The in-process execution above is the development path. Heavy diarization is
expected to move outward:

```text
Vercel web app  →  processing coordinator  →  external CPU/GPU worker
                                                    ↓
                                          diarization provider/model
                                                    ↓
                                          persistent result storage
```

The frontend keeps talking to `ProcessingJob`s either way, so moving from a
local development worker to a remote GPU worker requires no change to the
Transcript workspace, the persisted models or the Part 7 merge logic. Vercel
remains the web host, not an assumed ML worker platform.

### Explicit non-goals

Part 6 implements **no** transcript/speaker merging, no speaker naming or
identity recognition, no face recognition, no voiceprint enrollment or speaker
verification, no gender classification, no translation, no TTS or voice
cloning, no source separation, no timing alignment and no dubbing. Audio is not
sent to any provider beyond the configured diarization one.

## Part 7: Unified Transcript + Speaker Model

Parts 5 and 6 answer half a question each. Part 7 puts them together:

```text
Part 5 → TranscriptSegment[]   what was said, and when
Part 6 → SpeakerRegion[]       who spoke, and when
Part 7 → DialogueSegment[]     who said what, and when
```

### Unified architecture

```text
Transcript (raw, persisted)  ─┐
                              ├─→ DialogueMergeService ─→ UnifiedDialogue
DiarizationResult (raw, ──────┘         (pure merge)          ↓
                   persisted)                        UnifiedDialogueRepository
                                                              ↓
                                        GET /api/dialogue → DialogueClient → UI
```

The merge consumes **only** the normalised Part 5 and Part 6 domain models. It
has never heard of Whisper, pyannote, response formats, provider speaker
labels, credentials or model files — which is exactly what lets any STT
provider pair with any diarization provider, and what makes the algorithm
cheap to test. Speaker-assignment logic lives in neither provider interface.

### Raw results are preserved

The unified dialogue is **derived**. Merging reads the raw results and writes
only to its own store:

- the raw transcript stays persisted and unchanged;
- the raw diarization stays persisted and unchanged;
- the raw Transcript rows and Speaker Analysis panel stay visible, so Part 7
  adds a layer rather than replacing the ones beneath it;
- the dialogue can be deleted and rebuilt from the raw inputs at any time.

That matters because merge logic will improve, thresholds will be retuned, and
models will be rerun. A derived layer can be thrown away; raw results cannot.

### Dialogue model

```ts
interface UnifiedDialogue {
  id; projectId; sourceMediaId;
  transcriptId;      // the exact raw inputs this was derived from
  diarizationId;
  version;           // persisted schema version
  status: "completed" | "failed";
  segments: DialogueSegment[];   // ordered by start time
  createdAt; updatedAt;
  mergeMetadata: DialogueMergeMetadata;
}
```

`mergeMetadata` records the algorithm version, both input ids, when it ran, the
exact thresholds used, and how many segments came out ambiguous, overlapping or
unassigned — so any stored dialogue stays explainable later.

### Dialogue segment model

```ts
interface DialogueSegment {
  id: string;                  // derived from the transcript segment id
  speakerId: string | null;    // canonical speaker_N, or null when unassigned
  startTime: number;           // seconds
  endTime: number;             // seconds
  originalText: string;        // Part 5's text, unchanged
  transcription: { transcriptId, transcriptSegmentId, confidence, status,
                   providerId, providerModel };
  diarization:   { diarizationId, regionIds, confidence, overlap,
                   candidateSpeakers, providerId, providerModel };
  assignment:    { method, confidence, overlapRatio, uncertain, reason };
}
```

**Segment ids** are the transcript segment's own id. Regenerating from the same
transcript therefore reproduces the same ids, so state that later parts attach
to a line survives a rebuild. If word timestamps ever enable splitting one
transcript segment across speakers, the derived halves take suffixed ids
(`t-123:a`, `t-123:b`) so each stays distinct and stable. Array indexes are
never used as identity.

### Speaker assignment strategy

Assignment is temporal. For each transcript segment:

1. **Aggregate overlap per speaker.** Several regions from the same speaker are
   one candidate, not several.
2. **No overlap at all** → look for the nearest region within
   `nearestRegionMaxGap`. Within it, assign with `method: "nearest_region"` and
   `uncertain: true`; beyond it, leave the segment unassigned. Real silence is
   never bridged, and two speakers equally near resolve to neither.
3. **One candidate** → assign it (`single_overlap`). Coverage below
   `minSpeakerCoverage` keeps the assignment but flags it rather than
   overstating it.
4. **Several candidates** → a competitor only counts when it holds at least
   `splitMinimumDuration` of speech the leading speaker was *not* also
   producing. This is what separates a real second turn from boundary jitter,
   and what stops someone talking *over* the leader from looking like a turn
   change.
5. With a real competitor, the leader needs `dominantSpeakerRatio` of the
   attributed speech (`dominant_overlap`); otherwise the segment is
   **ambiguous and left unassigned**. An exact tie is always ambiguous — never
   broken by array order or speaker id.

### Merge configuration

Centralised in `src/lib/dialogue/merge-config.ts` and snapshotted onto every
dialogue. Defaults, chosen deliberately:

| Threshold | Default | Why |
| --- | --- | --- |
| `minSpeakerCoverage` | `0.5` | Below half a segment, a speaker is plausible but not solid |
| `dominantSpeakerRatio` | `0.75` | A 3:1 majority is a clear winner; nearer an even split is not resolvable without word timings |
| `splitMinimumDuration` | `0.2 s` | Shorter is boundary noise between two models, not a turn |
| `nearestRegionMaxGap` | `0.4 s` | Covers observed drift between the two models, far below any real pause |

These are tuning, not truth. Retuning them changes results, which is why the
values used are stored with each dialogue.

### Segments spanning multiple speakers

This is the case that most invites false precision, so the rule is explicit:

> **Without word-level timings, text is never divided.**

A transcript segment gives no evidence about which of its words fall on either
side of a speaker boundary. Splitting text by character count, or by ratio,
would invent that evidence. Instead such a segment keeps its **full text**,
names the dominant speaker when one exists, and reports
`uncertain: true` with the reason
`multiple_speakers_without_word_timestamps`. If no speaker dominates, the
speaker is `null` and the text is still preserved for correction in Part 8.

**No provider currently in Aidub emits word timestamps**, so the splitting
branch is not exercised today. The model is ready for it: `assignment.method`
reserves `"split"`, the id scheme above covers derived segments, and the plan
is documented under *Dialogue segment model*. When a provider supplies word
timings, splitting would associate each word with a speaker region, group
consecutive words by speaker, preserve word order and punctuation, narrow each
derived segment's timing to its own words, and keep every part traceable to the
original transcript segment.

### Overlapping speech

Overlap is preserved, never flattened. When two different speakers share time
inside a segment, `diarization.overlap` is `true`, every candidate speaker
stays in `candidateSpeakers` with its overlap duration and ratio, and the
segment is marked uncertain even if a dominant speaker was assigned. A speaker
talking over another does not remove the leader's claim to the line, but it
does mean the words may be interleaved — and the UI says so.

### Silence and missing coverage

A transcript segment with no speaker coverage is left unassigned
(`speakerId: null`) rather than given an invented speaker. No
`speaker_unknown` is minted. Diarization gaps stay gaps.

### Uncertainty and confidence

Two different things, kept apart:

- `assignment.confidence` is a **merge** confidence — the share of attributed
  speech belonging to the assigned speaker. It measures how cleanly the two
  timelines agreed, and nothing about any model's certainty.
- `transcription.confidence` and `diarization.confidence` are **provider**
  values, passed through untouched, and `null` wherever the provider reports
  nothing comparable. Neither is ever fabricated.

`assignment.overlapRatio` reports how much of the segment the assigned speaker
covers, and `assignment.reason` names why a segment is uncertain.

### Algorithm versioning and staleness

Every dialogue records `mergeMetadata.algorithmVersion`
(`dialogue-merge-v1`). A stored dialogue is current only for the exact
`projectId`, `sourceMediaId`, `transcriptId`, `diarizationId`, storage schema
and algorithm version that produced it. Change any of them — retranscribe,
rediarize, replace the source, ship new merge logic — and it is **stale** and
regenerated rather than served.

### Generation and regeneration

Generation is **lazy**: the first read after both prerequisites exist produces
and persists the dialogue; later reads reuse it until an input changes. That
keeps Part 5 and Part 6 unaware of each other — neither service knows a merge
exists — and needs no processing job, because merging is deterministic
in-memory work rather than model inference.

Missing prerequisites come back as a state, never a fabricated dialogue:
`transcript_required`, `diarization_required`, `source_mismatch` or `failed`.
An STT result from one source is never combined with a diarization from
another, however compatible their timestamps look.

Regeneration replaces the previous dialogue only once the new one is stored.
**Part 8 will have to revisit that policy**: once a user can edit dialogue,
overwriting on regeneration would discard their work, and an editable revision
layer (or explicit manual-edit state) becomes necessary. Part 7 is purely
derived and read-only, so replacement is safe for now.

### Lifecycle

- **Reopening a project** reuses the stored dialogue — same dialogue id, same
  segment ids, no re-merge.
- **Replacing the source** gives a new media id, so the old transcript,
  diarization and dialogue all stay tied to the old source and none appears as
  current for the new one.
- **Renaming a project** changes nothing: not the dialogue id, the segment ids,
  the raw input ids, the speaker ids or the source association.
- **Deleting media or a project** removes the derived dialogue alongside the
  raw results, through the service layer.

### Transcript workspace integration

The Transcript section shows three layers: the raw transcript, the raw Speaker
Analysis, and — above both — a **read-only** Dialogue preview with the speaker,
timing and text per line, plus `Uncertain` / `Unassigned` / `Overlap` badges.

It is not an editor. Editable text, speaker dropdowns, split and merge
controls, timing handles and inline translation all belong to Part 8 or later.

### The stable internal contract

Future features — transcript editing, translation, voice assignment, TTS,
timing, mix, export — should consume `UnifiedDialogue` rather than loading a
transcript and a diarization and correlating them again. The raw results stay
available for regeneration and debugging, but they are not the downstream
contract.

### Explicit non-goals

Part 7 implements **no** transcript editing, no translation, no TTS or voice
cloning, no voice assignment, no source separation, no timing alignment and no
dubbing or mixing. It aligns existing data; it does not change what was said.

## Part 8: Transcript & Speaker Editor

Part 7 produced a dialogue a machine derived. Part 8 turns it into a document a
person owns: the Transcript section becomes a synchronised review workspace
where the video, the transcript and a timeline share one selection, and where
text, speakers, timing and segment structure can all be corrected.

### Data hierarchy

```text
Raw STT (immutable)  ─┐
                      ├─→ generated unified dialogue ─→ manual corrections
Raw diarization ──────┘                                        ↓
   (immutable)                                    editable unified dialogue
                                                               ↓
                              translation · voices · TTS · timing · mix · export
```

### Raw data is immutable

**Correcting dialogue never modifies the transcript or the diarization.** Not
when text is rewritten, not when a speaker is renamed, reassigned or merged,
not when a segment is split, merged or retimed. The editor service has no
access to those stores at all, which is the simplest guarantee available, and
the promise is covered by tests that snapshot both raw records, run every
correction operation, and compare them afterwards.

The raw layers also stay *visible*: the Part 5 transcript and the Part 6
Speaker Analysis panel remain in the workspace beside the editor, so what the
models actually produced can still be checked against a correction. The raw
transcript sits behind a disclosure to keep it out of the way — except when it
found no speech at all, which is an outcome rather than a detail (it is what
distinguishes silence from a failed transcription), so that state is shown
directly.

### Speaker model

```ts
interface DialogueSpeaker {
  id: string;               // speaker_1 — stable, what everything joins on
  name: string;             // "Alice" — editable display metadata
  sourceSpeakerIds: string[];  // diarization clusters folded into this one
  createdManually: boolean;
  createdAt; updatedAt;
}
```

Renaming changes `name` only. The id every segment references is untouched, so
nothing downstream has to be re-pointed and no segment stores a copy of the
name — rows resolve it from the speaker record, which is why one rename updates
every line at once. Part 6's own `DiarizedSpeaker.label` is never written to.

### Dialogue edit state

```ts
interface DialogueEditMetadata {
  hasManualEdits: boolean;
  revision: number;          // one per persisted correction, not per keystroke
  editedAt: string | null;
  baselineAlgorithmVersion: string;
}

interface DialogueSegmentEditMetadata {
  manuallyEditedText / Speaker / Timing: boolean;
  manuallyChangedStructure: boolean;
  parentSegmentIds: string[];   // where a split or merged segment came from
}
```

Storage schema moved to **v2**. A v1 dialogue is migrated on read — speaker
records are reconstructed from its segments — rather than discarded for a field
addition.

### Synchronisation

One stable segment id ties the transcript, the timeline and the player
together, and two ids describe what is happening:

- `selectedSegmentId` — chosen by a person. Clicking a transcript row or a
  timeline block selects it, seeks the video to its start (**without**
  autoplaying) and highlights it in the other view.
- `activeSegmentId` — derived from playback position
  (`startTime <= currentTime < endTime`).

Keeping them separate is what stops the video advancing from pulling focus out
of a line someone is typing in.

Playback time is deliberately **not** React state. It lives in a small external
store that only the playhead and the transport readout subscribe to, so the
frame-rate updates never re-render the transcript rows or their open textareas.
Rows are memoised and re-render only when their own segment, or their
selected/active flags, actually change. The shared state lives in
`ProjectEditorProvider` at the workspace layout, so Translate, Voices, Mix and
Export can consume the same playhead and selection later.

### Text editing

The reviewed text is `DialogueSegment.originalText`; the raw transcript keeps
its own copy. Edits commit on blur — one persisted correction per edit, not one
per character — and Escape abandons an in-progress edit. Outer whitespace is
trimmed on commit and the wording is otherwise left exactly as typed. **Empty
text is allowed**: a false-positive transcription is a real thing to correct,
and blanking the line is more honest than inventing words for it; the line
keeps its timing and provenance so it can still be reassigned or merged away.

### Speaker reassignment

A manual choice is authoritative. `assignment.method` becomes `manual`, the
uncertainty the merge reported is cleared, and what the algorithm had decided
is preserved under `assignment.automatic` for provenance. Automatic assignment
is never reapplied on load. **Overlap metadata is deliberately untouched** —
choosing a primary speaker does not make overlapping speech disappear, and
later dubbing needs to know.

### Speaker merge

Folding `speaker_3` into `speaker_1` reassigns every line, records both cluster
ids in the survivor's `sourceSpeakerIds`, removes the source from the dialogue's
speaker list, and bumps the revision — all in one derived document that is
validated before it is written. A failed save leaves the previous document
exactly as it was; there is no half-merged state. Merging a speaker into itself
is refused. The confirmation says plainly that only this dialogue changes.

### Segment split

Timing splits exactly at the playhead. **Text does not split itself.** Without
word-level timings nothing knows which words fall on either side, so the split
dialog shows the line, offers the word boundaries as buttons, previews both
halves, and asks. Each half may be given its own speaker, which is the usual
reason to split in the first place.

Both halves keep the original's transcript segment id and region ids, and
record the parent in `parentSegmentIds`. Ids are derived from the parent
(`t-3:a`, `t-3:b`) so they are deterministic and traceable; repeated splits stay
unique. No provider currently emits word timings, so the word-timestamp path
described in Part 7 remains unexercised.

### Segment merge

Restricted to lines that are **adjacent on the timeline** and belong to the
**same speaker** — silently discarding one of two speakers' attributions would
be a destructive edit dressed up as a convenience, so the control is disabled
and the operation refused. To merge across speakers, reassign one first. The
survivor spans both, joins the text in order, and inherits the union of both
sides' region ids and their overlap flag.

### Timing edits

Times are typed as timecodes (`00:12.450`, `1:02:14.820`) and parsed back to
canonical seconds by `parseTimecode`; the formatted string is only ever
displayed. A selected block's edges can also be dragged on the timeline.

Validation rejects a negative start, an end at or before the start, non-finite
values and an end beyond the media duration, and nothing invalid is persisted.
Editing is **local**: gaps and overlaps are both legitimate, neighbours are
never shifted or trimmed to compensate, and a newly created overlap is reported
rather than prevented. There is no ripple editing.

### Save behaviour

Every correction is applied server-side against the stored document through
`PATCH /api/dialogue`, so validation and atomicity live in one place and a
client can never write a document derived from a stale copy. The saved result
replaces local state, which means what is on screen is what was persisted. A
failed save keeps the previous document and says so — an edit is never reported
as saved when the store rejected it.

A save in flight does **not** disable the text, timing and speaker fields. Text
commits on blur, and the two timestamps of a pair are separate fields, so the
first one committing starts a save while the second is still being typed —
disabling the row there would throw the entry away. Those edits are keyed to
stable segment ids and compose server-side, and a field only resyncs from the
store while it is not focused, so an in-progress correction is never
overwritten by an arriving one. Only *Split* and *Merge up* wait for the save,
because they depend on the document's current shape.

### Regeneration safety

Once `editMetadata.hasManualEdits` is true, **new transcription or diarization
results never overwrite the dialogue**. The edited document stays active and
the response carries a `staleBaseline` describing what changed, which the
workspace surfaces as a notice. Reconciling corrections against newer raw
results is a genuine merge problem and is deliberately left to a later part
rather than guessed at here. A dialogue nobody has edited still regenerates
normally.

### Timeline scope

One dialogue track: position, duration, speaker, selection and a playhead that
follows playback. It is **not** the Mix timeline — no music tracks, stems, TTS
waveforms, multitrack mixing or render tracks. Very short lines are drawn with
a minimum clickable width; that affects only what is drawn, never the stored
timestamps. Speaker tones come from design tokens and are assigned
deterministically from the speaker id, and are always paired with the speaker's
name in text rather than being the only cue.

### Explicit non-goals

Part 8 implements **no** translation, no TTS or voice cloning, no voice
assignment, no source separation, no automatic timing alignment or TTS duration
fitting, and no dubbing, mixing or export. It corrects the original-language
dialogue; it does not generate anything.

## Part 9: Translation Provider System

Part 8 produced a dialogue a person has corrected. Part 9 answers one question
about it — **what is the translated text for each existing dialogue segment?**
— and nothing more. It is the provider-independent foundation Part 10's
dubbing-aware translation is built on, not that translation itself.

### Translation architecture

```
Current editable UnifiedDialogue   (Parts 7–8, corrections included)
        ↓
ProcessingJob  type: "translate"   (the same job system as every other stage)
        ↓
TranslationService                 (resolve, validate, batch, verify, persist)
        ↓
TranslationProvider                (the only thing that knows a vendor)
        ↓
Normalized TranslationProviderResult
        ↓
TranslationRepository              (DialogueTranslation, stored separately)
```

Each layer is replaceable without touching the ones above it. The Translate
workspace knows nothing about API payloads, prompts, model names,
authentication, batching, or whether translation runs locally, in a hosted API,
or on an external worker.

### The input is the corrected dialogue, never raw STT

This is the rule the rest of Part 9 depends on. `TranslationService` resolves
the current dialogue through `DialogueService` — the same document the
Transcript workspace shows — and builds its request from that. So a line whose
text was rewritten, whose speaker was reassigned, whose timing was corrected, or
which was split or merged in Part 8 reaches the provider **as corrected**. The
raw Part 5 transcript is never read here, and the pipeline is:

```
Raw STT + raw diarization → UnifiedDialogue → Part 8 corrections
                                     → current editable dialogue → translation
```

### Provider abstraction

`TranslationProvider` (`src/server/translation/translation-provider.ts`) is
deliberately not HTTP-shaped, so one abstraction covers hosted machine
translation APIs, LLM providers, self-hosted models and external workers:

```ts
interface TranslationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: TranslationProviderCapabilities;
  isAvailable(): Promise<boolean>;
  translate(
    request: TranslationRequest,
    context?: TranslationProviderContext,
  ): Promise<TranslationProviderResult>;
}
```

`capabilities` (batching, context, glossary, confidence, usage) exists so the
service can adapt without hard-coding provider knowledge — a provider that
cannot batch is simply driven one line at a time.

Two providers ship:

- **`openai-compatible`** (the default) — real translation through any
  OpenAI-compatible `POST /chat/completions` endpoint, which covers OpenAI and
  Azure OpenAI, gateways such as OpenRouter, and self-hosted servers that copy
  the shape (vLLM, Ollama, LM Studio, llama.cpp, TGI). Hosted API and
  self-hosted model are the same adapter and a different base URL. It requires
  `AIDUB_TRANSLATION_API_KEY`; without it the provider reports itself
  unavailable and the job fails with one clear message rather than part way
  through.
- **`mock`** — a deterministic test double returning `[<target>] <source>`. It
  is only registered when `AIDUB_TRANSLATION_PROVIDER=mock` names it
  explicitly, so a misconfigured deployment fails loudly instead of quietly
  shipping placeholder subtitles.

Configuration is centralised — `AIDUB_TRANSLATION_PROVIDER`,
`AIDUB_TRANSLATION_BASE_URL`, `AIDUB_TRANSLATION_MODEL`,
`AIDUB_TRANSLATION_BATCH_SIZE`, `AIDUB_TRANSLATION_TIMEOUT_MS` — so a future
Settings screen changes the provider by writing one value.

### Translation request contract

```ts
interface TranslationRequest {
  projectId: string;
  sourceMediaId: string;
  dialogueId: string;
  dialogueRevision: number;
  sourceLanguage: string;
  targetLanguage: string;
  segments: {
    segmentId: string;      // the stable dialogue segment id
    speakerId: string | null;
    startTime: number;      // numeric seconds
    endTime: number;
    sourceText: string;     // the corrected dialogue text
  }[];
}
```

The language pair is always explicit, taken from `project.sourceLanguage` and
`project.targetLanguage`. A provider is never left to infer the target.

### Structured output, never guessed

An LLM provider sends each line as an object carrying its segment id and
requires JSON back keyed by the same ids. Aidub never sends several lines as one
paragraph and then tries to split the answer — there is no reliable way to do
that, and a wrong split silently misattributes dialogue.

Provider answers are matched **by segment id, never by array position**
(`src/lib/translation/validate-translation.ts`). Four contract violations fail
the job rather than being repaired:

| Violation | Code |
| --- | --- |
| A requested line is missing | `TRANSLATION_INCOMPLETE_RESPONSE` |
| A line comes back twice | `TRANSLATION_DUPLICATE_SEGMENT` |
| A line was never requested | `TRANSLATION_UNKNOWN_SEGMENT` |
| A line with text comes back empty | `TRANSLATION_EMPTY_RESULT` |

Nothing is fabricated to fill a gap: a translation with a silently blank or
wrong line is worse than none, because it looks finished.

### Translation data model

```ts
interface DialogueTranslation {
  id: string;
  projectId: string;
  sourceMediaId: string;
  dialogueId: string;
  dialogueRevision: number;   // the exact revision translated
  sourceLanguage: string;
  targetLanguage: string;
  providerId: string;
  providerModel: string | null;
  version: number;            // storage schema version
  status: "processing" | "completed" | "failed";
  segments: TranslatedDialogueSegment[];
  createdAt: string;
  updatedAt: string;
  providerMetadata?: Record<string, unknown>;
  usage?: TranslationUsage | null;
}
```

```ts
interface TranslatedDialogueSegment {
  id: string;                 // this record's own identity
  dialogueSegmentId: string;  // the relationship everything joins on
  speakerId: string | null;   // copied from the dialogue
  startTime: number;          // copied from the dialogue
  endTime: number;
  sourceText: string;         // snapshot of what was translated
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  confidence: number | null;
  providerMetadata?: Record<string, unknown>;
}
```

### Separation from the source dialogue

`DialogueSegment.originalText` is **never** overwritten. Translated text lives
only in `TranslatedDialogueSegment.translatedText`, in a separate record, in a
separate store. Both languages are available simultaneously, which is what voice
assignment, TTS, timing and export need. Translation also never writes to the
dialogue, the transcript or the diarization — the service holds no reference to
those stores at all, and a test snapshots all three across a full translation to
prove it.

Structure is 1:1 and comes from the dialogue, not the provider: output order is
the dialogue's timeline order whatever order the provider answered in, and a
line with empty source text is preserved as an empty translated line rather than
dropped — and is never sent to a provider, which would spend credits to invite a
model to invent dialogue.

### Staleness

A translation is valid only for the exact tuple:

```
projectId + sourceMediaId + dialogueId + dialogueRevision
          + sourceLanguage + targetLanguage
```

Part 8 bumps the dialogue revision on every persisted correction, so any edit —
text, speaker, timing, split or merge — makes the whole translation stale. That
is coarse on purpose: Part 9 stores each line's source text, speaker and timing
precisely so a later part can determine *which* lines changed and retranslate
only those. Guessing at partial validity now risks presenting text translated
from a sentence the user has since rewritten.

**Stale never means deleted.** The translation stays stored and stays findable —
switching the target language back, or undoing an edit, finds it again — it is
simply presented as out of date, with a `Retranslate` action. Changing the
default provider does *not* invalidate anything: each translation records the
provider that made it.

### Processing jobs

Translation is a `translate` processing job — the same lifecycle, progress,
cancellation and error model as every other stage, not a second job system. Two
things are new:

- **Job parameters.** `ProcessingJob.parameters` is a typed, discriminated
  union carrying the dialogue id, dialogue revision and language pair. Later
  stages that need their own inputs extend it rather than adding nullable
  scalars to every job.
- **Media-free jobs.** Translation reads the stored dialogue, so a translate job
  carries **no source video at all** — no upload, no temp file, no FFmpeg. The
  request path, the service and the client all branch on
  `jobTypeNeedsSourceMedia`, and a media-free stage's `ensureAudio` throws, so
  it cannot quietly start depending on media its job never carried.

Progress is real, not fabricated: the service batches the dialogue itself
(`AIDUB_TRANSLATION_BATCH_SIZE`, default 20) and reports completed lines over
total lines — "Translating 14 of 52 lines". Cancellation is checked between
batches as well as inside them, so a cancelled job stops before spending another
provider call, and a result that arrives after cancellation is discarded rather
than saved.

Timeout policy is **per provider request**, not per project: a long dialogue
legitimately takes many minutes, and a whole-job ceiling would either be
uselessly large or would kill healthy long translations.

Retry creates a **new job**; a failed job stays failed and historical. A retry
uses the dialogue's current revision, so retrying after an edit translates what
is actually there now.

### Provider metadata, usage and confidence

`providerId` and `providerModel` are persisted on every translation; vendor
detail goes in `providerMetadata` and never becomes a core field. Usage is
normalised (`TranslationUsage`) and summed across batches, with absent
measurements staying absent — a provider that reports nothing gets
`usage: null`, never zeros, because zero reads as "this cost nothing" rather
than "this was never measured". Part 9 records usage; it does not price it.

Confidence is `null` unless a provider reports something genuinely comparable in
0–1. Most translation providers, LLMs included, do not.

### Credentials

Provider credentials are read from the server environment inside the adapter and
go nowhere else: never into a `NEXT_PUBLIC_*` variable, a client bundle, a
persisted translation, provider metadata returned to the frontend, or a log
line. Logs carry identifiers, counts, language codes and usage totals — never
dialogue text or translated text.

### Production architecture

```
Vercel Aidub web app
    → processing/job coordinator
        → external translation worker or provider API
            → TranslationProvider
                → translation persistence
```

Vercel remains the web host. Nothing assumes a self-hosted translation model
runs inside a Vercel function; `TranslationService` takes a job context and a
repository, so running it on an external worker is a deployment change, not a
rewrite.

### Translate workspace

`/projects/[projectId]/translate` shows the prerequisite state, the language
pair and dialogue line count, the `Translate` action, live job
progress/stage/cancel, normalised errors with `Retry`, and a read-only preview
pairing each original line with its translation. Speaker names are resolved from
the **current dialogue**, so renaming a speaker in the Transcript editor shows
through immediately instead of leaving a stale copy behind.

A project whose source and target languages match is blocked with an
explanation rather than translated — spending provider credits to reproduce text
we already have is not a useful default.

### Explicit non-goals

Part 9 implements **no** dubbing adaptation of any kind: no shortening or
expansion to fit a take, no lip-sync-aware phrasing, no syllable or duration
fitting, no scene or neighbouring-line context, no character-voice consistency,
no alternate translations, no cultural or politeness adaptation. It also has no
translation editing, no TTS, no voice cloning, no timing alignment, no source
separation and no mixing or export. The completed translation is read-only.
Those belong to Part 10 and later, and are exactly what this provider and data
layer exists to support.

## Part 10: Context-Aware Dubbing Translation

Part 9 translated each line faithfully and in isolation. Part 10 changes the
question from *"is this line translated correctly?"* to *"does this line work as
spoken dubbing?"* — which needs the conversation around it, the character
speaking it, and the time it has to be said in.

```
Current editable UnifiedDialogue
        ↓
Context builder            (bounded, structured, from the corrected dialogue)
        ↓
Translation service        (full · regenerate one line · shorten one line)
        ↓
TranslationProvider        (the Part 9 abstraction, unchanged in shape)
        ↓
Context-aware translated segments + duration metadata
        ↓
Human review and editing   (translated text only)
        ↓
Persisted dubbing translation → Part 11 voice generation
```

### Context strategy

Translating "Yes, he said he'll come." on its own throws away everything needed
to translate it well: who "he" is, whether these two are on formal terms, and
what was actually asked. So the surrounding lines travel with the request.

- **Window.** Three lines before and three after by default, plus up to two
  earlier lines by the same speaker for register consistency. Configurable in
  one place (`DEFAULT_TRANSLATION_CONTEXT_CONFIG`), never scattered.
- **Structured, never flattened.** Each neighbour keeps its segment id, speaker
  and position. Merging them into a paragraph is exactly how a provider loses
  track of which line it was asked about — and speaker names are user-supplied
  text, so they travel as JSON values rather than being interpolated into an
  instruction.
- **Bounded.** A character budget trims from the outside in: speaker history
  first, then the farthest neighbours, so the immediately adjacent lines are the
  last to go. The line being translated is never trimmed and never appears as
  its own context.
- **Current.** Context is built from the editable dialogue — the corrected text
  a person reviewed — never from the raw Part 5 transcript, and it is validated
  against the dialogue before every provider call, so context from an older
  revision cannot quietly inform a new translation.
- **Batches** carry boundary context only: the lines just before the first and
  just after the last, since a batch is already internally consecutive.
- **Existing neighbour translations** travel too when regenerating a single
  line, which is what keeps a name spelled the same way and a reply agreeing
  with the line before it.

The segment ids that informed each line are persisted
(`translationMetadata.contextSegmentIds`) — ids only, because the text lives in
the dialogue and copying it would go stale the moment the dialogue changed.

### Dubbing translation philosophy

The provider is asked for what a person would actually say out loud: natural
word order, contractions, fragments left as fragments, register kept as the
source has it. Meaning, intent and tone come first; a literal grammatical
equivalent that no one would say is a worse dub than a natural paraphrase.

What it is explicitly told **not** to do is just as important: never add emotion
or detail the source does not have, never merge, split, reorder or drop lines,
never translate a line it was not asked about, and never remove essential
meaning to satisfy a duration.

### Duration awareness

Each line's slot is `endTime - startTime`. Against it sits an **estimate** of how
long the translated text would take to say, produced by a pure, deterministic,
provider-independent estimator (`estimateSpeechDuration`): spoken characters
divided by an approximate per-language rate, plus a small beat for sentence and
clause punctuation.

| Ratio (estimated ÷ available) | Warning |
| --- | --- |
| ≤ 1.15 | `none` |
| 1.15 – 1.35 | `slightly_long` |
| > 1.35 | `likely_too_long` |

Thresholds live in one place (`DURATION_RATIO_THRESHOLDS`), and the estimator
carries a version (`durationEstimatorVersion`) so a later, better estimator can
be told apart from this one.

**This is an estimate from text, not TTS timing.** Aidub has synthesised
nothing; actual duration depends on the voice, rate, pauses and emphasis Part 11
chooses. Language rates are rough conversational averages, not measurements.
That is precisely why the output is a warning a person acts on rather than a
constraint the system enforces — and why Part 10 never loops re-compressing a
line automatically, which would degrade meaning quietly and spend credits doing
it. The first translation considers duration; if a line still overruns, it is
flagged and the person decides.

The estimate is recomputed on **every** change to translated text — initial
generation, regeneration, shortening, and a manual edit — so a warning can never
describe wording the line no longer has.

### Translation metadata

Every translated line carries:

```ts
interface DubbingTranslationMetadata {
  providerId: string;
  providerModel: string | null;
  generationMode: "initial" | "regenerate" | "shorter";
  generatedAt: string;
  contextSegmentIds: string[];
  estimatedDurationSeconds: number | null;
  sourceDurationSeconds: number;
  durationRatio: number | null;
  durationWarning: "none" | "slightly_long" | "likely_too_long";
  durationEstimatorVersion: string;
  confidence: number | null;
  providerMetadata?: Record<string, unknown>;
}

interface TranslationEditMetadata {
  manuallyEdited: boolean;
  revision: number;
  editedAt: string | null;
}
```

Provenance survives a manual edit: the provider and model that produced the
wording someone then rewrote stay on the record.

### Translate editor

`/projects/[projectId]/translate` is now the review workspace: speaker and
timecode, the original, and the translation, one row per dialogue line.

- The **original is read-only.** Correcting what was said belongs to Transcript;
  a second editable copy here would give one sentence two homes and no answer to
  which wins. A link to Transcript is offered instead.
- The **translation is editable inline** — a plain autosizing textarea, no modal.
  It commits on blur (one save per edit, not per keystroke) and follows the
  stored text only while unfocused, so an arriving save never yanks words out
  from under someone typing. Save state reads `Saving… / Saved / Save failed`,
  and a failure says so rather than claiming success.
- Speaker names resolve from the **current dialogue** by stable `speakerId`, so
  renaming a speaker in Transcript shows through immediately and never justifies
  retranslating anything.
- Clicking a row selects the same dialogue segment id Transcript and the
  timeline use, and seeks the shared player — one identity for a line across the
  whole workspace, never a second mapping.
- Timing is displayed and **not editable** here.

### Segment regeneration

Regenerating one line is surgical: it is sent with the conversation around it
(including neighbours' existing translations), and every other line comes back
byte-identical. The current text stays until a new one has been validated and
stored — if the provider fails, the contract check fails, the dialogue moves
underneath, or a concurrent edit lands, the existing wording is what remains.

A result naming a **context-only** line is rejected outright rather than
applied, so background can never overwrite a neighbour.

### Shorter alternative

A line flagged `likely_too_long` gets a prominent **Make shorter**. The provider
is asked to keep the full meaning, intent and tone and drop filler and
roundabout phrasing — never information. Timestamps are untouched.

Nothing assumes the result is actually shorter: the duration is re-estimated
from what came back and the warning recomputed, so a "shortening" that produced
something longer is reported as still too long. Asking again is always an
explicit action; there is no automatic loop.

### Manual edit authority

Once someone edits a line, `editMetadata.manuallyEdited` is true and **their
wording is what Part 11 will speak**. Nothing regenerates over it without them
asking: regenerating a hand-edited line asks for confirmation, and so does a
full retranslation when the translation contains manual edits — with the
existing translation kept until the new run succeeds, so a failed rerun costs
nothing.

### Staleness and concurrency

Part 9's rule stands: a translation is valid only for one project, source media,
dialogue, dialogue revision and language pair. Part 10 adds the guards a
per-line workflow needs:

- A **stale** translation blocks segment operations. Regenerating one line
  against a dialogue that has moved on would translate text nobody is looking
  at, so the workspace asks for a full retranslation instead — the old
  translation stays visible and is never silently rebound.
- Every segment operation re-checks the **dialogue revision** immediately before
  writing, and rejects the result as `TRANSLATION_SOURCE_CHANGED` if it moved.
- Every segment operation carries the **translation revision** it was built
  against and refuses to write if someone else's edit landed meanwhile
  (`TRANSLATION_REVISION_CONFLICT`), so a slow request cannot clobber a newer
  one it never saw.
- The workspace disables conflicting controls while any operation runs, so a
  Regenerate and a Make shorter cannot race each other onto the same line.

### Processing jobs

All three operations are `translate` jobs — one job type, one lifecycle, one
cancellation and error story. `TranslateJobParameters.operation` is `full`,
`regenerate_segment` or `shorten_segment`; the segment operations also carry the
line and the expected translation revision. A full run reports real progress
("Translating 14 of 52 lines"); a single line reports simply that it is
regenerating. Cancelling never overwrites the active translated text, and a
retry is a new job — failed jobs stay failed and historical.

### Part 9 data migration

Stored translations are schema **v2**. A v1 record is migrated on read, not
discarded — the text in it cost provider credits. Defaults say what is actually
known: `contextSegmentIds: []` (no context was used), `generationMode: "initial"`
(Part 9 had no other way), `manuallyEdited: false` (Part 9 had no editing), and
the provider and model it already recorded. The duration metadata is *computed*
rather than defaulted, since it derives purely from text and language and is
just as valid for old text as new.

### Production architecture

Unchanged: Vercel hosts the web app, the job coordinator dispatches work, and a
provider or external worker does the inference. `TranslationService` takes a job
context and repositories, so running it on an external worker stays a deployment
change.

### Explicit non-goals

Part 10 implements **no** TTS, no voice generation or preview, no voice cloning,
no measurement of synthesised speech, no timing correction (timestamps are never
changed to fit a translation), no lip sync or phoneme alignment, no source
separation, and no dubbed audio or video render. Duration awareness is
preparation for Part 11, not synchronisation.

## Part 11: Text-to-Speech Foundation

Part 10 produced reviewed, dubbing-oriented translated text and an estimate of
whether each line would fit. Part 11 speaks it. It turns the current translation
into actual audio: a voice per character, a generated line per dialogue segment,
stored so a person can play it against the original and hear what the dub sounds
like.

It is the provider-independent foundation the later parts build on, and it stops
there. Part 11 does **not** clone a voice, align speech to the original timing,
separate the source audio, mix anything, or export a dubbed video.

### Speech architecture

```
Current translation (Part 10)
        │
        ▼
SpeakerVoiceAssignment  ← a person casts each speaker
        │
        ▼
generate_speech job ──► TtsGenerationService
                              │
                              ├─► TtsProvider  (local-vits │ mock │ …)
                              │        └─ worker thread, blocking native call
                              ├─► ProcessingArtifactStorage  (the audio bytes)
                              └─► GeneratedSpeechRepository  (the metadata)
```

Five things are kept apart on purpose:

- **who is speaking** — `DialogueSpeaker.id`, decided by Parts 6–8;
- **what voice exists** — `TtsVoice.id`, a provider's own catalog entry;
- **who is cast as what** — `SpeakerVoiceAssignment`, the only record that links
  the two, and the only one a person authors;
- **what was generated** — `GeneratedSpeechSegment`, metadata and provenance;
- **the audio itself** — a `generated_speech` artifact in the shared store.

Conflating the first two would make a voice change look like a speaker change.
Conflating the last two would make every read of the workspace pull megabytes of
base64.

### The input is the edited translation, never raw STT

Speech generation reads the **current `DialogueTranslation`** — the text a person
reviewed, edited, regenerated or shortened in Part 10. It never reads the Part 5
transcript, the Part 6 diarization, or even the dialogue's own `originalText`.
A manual correction someone made to a translated line is exactly what gets
spoken.

It also never writes upstream. The translation, dialogue, transcript and
diarization are read and copied; generated audio is a separate record, and the
service literally cannot reach those stores to modify them. Generated audio is
**derived**: it can always be produced again.

### Provider abstraction

`TtsProvider` in `src/server/tts/tts-provider.ts` is the boundary. Above it, the
generation service, the job and the Voices workspace speak only in Aidub's terms.
Below it, one adapter owns model names, endpoints, credentials, audio containers,
SSML dialects, native runtimes and retries.

It is deliberately not HTTP-shaped: a provider may call a hosted API, run a model
on this machine, or hand work to a GPU worker, and the abstraction has to survive
all three.

A provider speaks one line. It never chooses a voice, never merges or splits
lines, never moves a timestamp, and never sees the project's dialogue. One line
per call rather than a batch, so a failure costs one line rather than a run,
cancellation lands between lines, and progress is real.

`TtsProviderCapabilities` lets a provider say what it actually honours.
`applicableSettings` then drops the rest, so a stored record never claims a
speaking rate that never applied.

Two adapters ship:

- **`local-vits`** — a real, self-hosted Piper VITS model via `sherpa-onnx-node`.
  Runs on CPU, on this machine. No audio and no dialogue leaves the machine, no
  credentials are involved, nothing is billed. Models come from a public GitHub
  release via `npm run setup:tts` (~250 MB, gitignored, never committed). The
  runtime and the models are both optional: `isAvailable()` reports false when
  either is missing, so Aidub builds and runs without them and the workspace says
  so plainly.
- **`mock`** — deterministic, development-only, produces real playable WAV so the
  whole path can be exercised without a download. It is **not speech** and nothing
  it returns should ever be presented as dubbed audio. Registered only when named
  explicitly by `AIDUB_TTS_PROVIDER`, so it can never become a silent fallback.

`AIDUB_TTS_PROVIDER` selects the default in one place. Adding a provider is a
registry change: no domain code, no persisted model, no job change, no UI change.

### Blocking native calls run off the request thread

Synthesis is one blocking native call per line — hundreds of milliseconds each,
hundreds of lines per project. On the main thread it would freeze the Node event
loop for the whole run: no request served, including the cancel the user just
clicked.

So it runs on a worker thread (`local-vits-worker.ts`), and **cancellation
detaches rather than kills** — the same rule Part 6 established. The native call
cannot be interrupted, and terminating a worker mid-call tears down a thread the
addon is still using, which aborts the entire process. An aborted line frees the
caller immediately and abandons the worker; it finishes on its own, its result is
never read, and being unref'd it holds nothing open. That worker boundary is also
the seam a remote GPU worker slots into later.

### Voice assignment

A `SpeakerVoiceAssignment` is keyed by the **stable** `speakerId`, so renaming a
speaker in Transcript changes nothing, and reassigning a line to another speaker
changes which voice speaks it without anyone re-picking. The record's id is
derived from dialogue + language + speaker, so re-casting replaces one record
rather than leaving rivals to disagree.

**Aidub never chooses a voice.** Not from the audio, not from a name, not from
the diarization, not from the transcript, and not from any inferred attribute of
a speaker. Those would be guesses about people. A voice is whatever a person
picked after listening, and a speaker with no voice stops a run rather than being
cast automatically. The catalog is the same list for every speaker; the only
thing that differs is the choice.

`VoiceSource` is a discriminated union with one member today. Part 12's cloned
voices arrive as a new variant, not a rewrite of every stored assignment — and a
record naming a variant this build does not understand is rejected on read rather
than loaded as a standard voice and spoken in the wrong one.

### Staleness

`src/lib/tts/tts-staleness.ts` answers "is this audio still what the project
currently says?" in one place, because the failure mode is silent: a dubbed line
that plays confidently while speaking a sentence the user rewrote, in the voice
they replaced.

Audio goes out of date when the translated text or its edit revision changes, the
whole translation is replaced, the line's speaker changes, the voice or its
settings change, the target language changes, or the storage schema changes. All
of those are folded into one `fingerprint` at generation time, so the check is one
equality comparison — with individual comparisons afterwards purely so the
workspace can say *what* changed rather than just "outdated".

**Stale never means deleted.** The audio stays stored and stays playable; it is
simply not what a later mix should use, and the workspace says so.

A line with nothing to say — empty, or punctuation only — is recorded as
`skipped_empty` rather than skipped: the structure stays 1:1 with the translation,
no provider call is spent on an ellipsis, and no silence file is generated. The
same `hasSpeakableText` predicate decides this for both the service and the
staleness check, so such a line settles as current instead of being regenerated
forever.

### Duration is measured, never corrected

Part 10 estimated a line's length from text. Part 11 has the real thing: an
actual measured duration of actual audio, read from the WAV header when a provider
does not report one. Both are kept — they answer different questions, and
overwriting the estimate would lose the record of what was predicted.

Where generated speech runs longer than its dialogue window, that is recorded as a
warning and shown as two durations plus their ratio. **That is all Part 11 does
about it.** No stretching, no compressing, no rate adjustment, no moved
timestamps, no automatic retry loop. Making a line fit is Part 10's "Make
shorter", which is a person's decision.

### Processing jobs

Speech generation is a `generate_speech` job in the shared job architecture —
never a second job system. Two operations share it because they differ in scope,
not lifecycle: `full_project` speaks everything that needs speaking,
`single_segment` speaks exactly one line and leaves every other record
byte-identical.

Like `translate`, it carries **no source media**: it reads the translation the
backend already holds, so no video crosses the network to generate speech.

The job names the exact translation id and revision it was created for, and that
is re-checked at the end of a run as well as the start — a full run takes minutes,
and a translation edited during it must not have audio of its old text filed as
current.

A run refuses up front if any speaker with spoken lines has no voice: discovering
that at line 80 of 100 wastes 79 provider calls and leaves a half-dubbed project.
A failure on one line is recorded, not thrown — one hiccup must not discard the
lines that worked — and the previous take, bytes and all, survives it. New audio
is stored before the take it replaces is released.

### Artifact access

Audio bytes live in the shared `ProcessingArtifactStorage` behind an
`artifactId`, added via `saveBytes` (FFmpeg writes files; a synthesis provider
returns a buffer, and making it invent a temp file would put filesystem concerns
back into a service that has no business knowing about them).

Playback is checked **twice**: the generated record must belong to the project
that asked for it, and the artifact must belong to that project too. Either check
alone leaves a hole — a guessed record id without the first, a guessed artifact id
without the second — and record ids here are derived from dialogue segment ids
rather than random, so guessability is a real property, not a hypothetical.
Filenames are built entirely from backend identifiers, and no response carries a
filesystem path.

### Credentials

Speech providers are constructed and called **server-side only**. No API key,
private token or model URL reaches `NEXT_PUBLIC_*`, a browser bundle, a client
component, a stored record, or a log line. Logs carry identifiers, counts and
durations — never translated text, never a credential, never a model path.

### Voices workspace

`/projects/[projectId]/voices` is the section. It shows the cast list, generates
speech, plays each dubbed line against the original on the shared player, and
reports where a line runs long or has gone out of date. It knows nothing about
which provider runs, whether it is local or hosted, or what a call costs.

Voice previews use fixed neutral text rather than the character's own lines: an
audition is about hearing the voice, and it should never be mistakable for a
generated take. Preview audio is returned directly and never stored — it is not
part of the project.

### Production architecture

`TtsGenerationService` takes a job context and repositories, not an HTTP request,
so moving generation to an external worker stays a deployment change. Both
development stores (temp-directory JSON) sit behind interfaces a database
replaces without touching the service or the workspace — and of everything Part 11
stores, the voice assignments most want a real one, because a lost casting
decision cannot be recomputed.

### Explicit non-goals

Part 11 implements **no** voice cloning, no reference-recording capture, no timing
alignment or synchronisation of generated speech to the original, no lip sync, no
audio time-stretching or compression, no source separation, no mixing with the
original audio, and no dubbed audio or video export. It generates speech, stores
it, and reports honestly where it does not fit.

## Not implemented (on purpose)

Authentication, accounts, billing, a production database, cloud media storage,
transcoding for delivery, proxy or thumbnail generation, waveform generation,
real queues and external workers, source separation, voice cloning, speaker
naming or identity recognition, timing alignment, lip sync, audio
time-stretching, the dubbing/mixing timeline, export/render processing,
analytics and collaboration are all still out of scope. Part 11 stops at
generated speech: each reviewed translated line has dubbed audio a person can
play against the original, in a voice they cast, with an honest measurement of
where it runs long — and nothing is aligned, mixed or exported. There are no placeholder or mock API routes for those
features. Project and media persistence exist only in the temporary
browser-local forms described above.

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

Part 5 adds:

43. Speech-to-text providers stay behind `SpeechToTextProvider`, and the
    Transcript UI stays provider-agnostic.
44. Provider response shapes never become the core transcript model; vendor
    extras live in `providerMetadata`.
45. Transcription runs as a `transcribe` processing job — never a second,
    parallel AI-job system.
46. Every transcript belongs to a project **and** an exact `sourceMediaId`, and
    references the audio artifact it was made from.
47. Transcript segments have **stable ids** and timestamps in **numeric
    seconds**.
48. `originalText` is the original-language transcription and must never be
    overwritten by a translation.
49. Speaker information is not part of speech-to-text; diarization refines
    these existing segments later.
50. Confidence is optional and never fabricated.
51. Completed transcripts persist independently of jobs; reopening a project
    reuses the stored transcript instead of transcribing again.
52. Replacing source media never reuses the old source's transcript.
53. Local/self-hosted models and external APIs must both be addable without
    changing the transcript domain model or the UI.
54. Provider secrets stay server/worker-side.
55. Long-running transcription is never permanently tied to Vercel functions.
56. Future translation references stable transcript segment ids.

Part 6 adds:

57. Speech-to-text and diarization are **independent systems**; diarization is
    never added to `SpeechToTextProvider`, and Aidub must stay able to mix STT
    provider A with diarization provider B.
58. Diarization providers stay behind `SpeakerDiarizationProvider`, and the
    Speaker Analysis UI stays provider-agnostic.
59. Provider-specific speaker labels are **normalised before persistence** and
    never enter the domain model; raw labels survive only in
    `providerMetadata`.
60. Aidub speaker ids are canonical (`speaker_1`, `speaker_2`, …), assigned by
    **first appearance on the timeline**.
61. Speaker ids are **anonymous clusters, not real-world identity**, and are
    stable within a persisted result — not across independently recomputed runs.
62. Every diarization belongs to a project **and** an exact `sourceMediaId`, and
    references the audio artifact it was made from.
63. Diarization consumes the Part 4 canonical audio artifact and never runs its
    own extraction.
64. Speaker regions use **numeric seconds** and have **stable ids**.
65. Overlapping speaker regions stay representable and are never forced apart;
    silence stays a timeline gap and is never filled with a placeholder speaker.
66. Confidence is optional and never fabricated.
67. Transcript segments are **not modified** by diarization — no speaker fields,
    no changed text, no changed timings.
68. Merging the transcript and speaker timelines belongs to Part 7, which
    operates on normalised ids and timestamps, never on raw provider responses.
69. Completed diarizations persist independently of jobs; reopening a project
    reuses the stored result instead of rerunning the model.
70. Replacing source media never reuses the old source's diarization.
71. Heavy diarization may move to external CPU/GPU workers; Vercel stays the
    web host, not the assumed ML worker platform.

Part 7 adds:

72. Raw STT and diarization results are **independent, immutable inputs** to
    merging; the merge reads them and never writes to them.
73. The unified dialogue is a **derived** application model, produced by the
    merge layer — never by a provider.
74. A dialogue references the exact `transcriptId` and `diarizationId` it was
    derived from, and belongs to an exact project and source media id.
75. Dialogue segments use **numeric seconds** and preserve Part 5's
    `originalText` unchanged — no translation, rewriting or correction.
76. Canonical speaker ids come from Part 6; the dialogue never mints its own.
77. Speaker assignment is based primarily on **temporal overlap**, aggregated
    per speaker.
78. Ambiguous assignments are represented explicitly (`speakerId: null` plus
    assignment metadata), never guessed, and never decided by array order.
79. Overlapping speech stays represented; large silence gaps are never bridged,
    while small timing drift may use the nearest-region fallback.
80. **Without word timestamps, text is never split across speakers.**
81. Segment ids are stable once persisted, and derived from the transcript
    segment they trace to.
82. The merge algorithm version and its configuration are recorded on every
    dialogue.
83. A dialogue becomes stale when its transcript, diarization, source, schema
    or algorithm version changes, and is regenerated rather than served.
84. Raw transcript and diarization must remain available for regeneration.
85. Transcript editing, translation, voice assignment, TTS, timing, mix and
    export consume the `UnifiedDialogue` contract rather than rejoining raw
    STT and diarization themselves.
86. Part 7 dialogue is read-only and derived; Part 8 owns manual editing, and
    must revisit the regeneration policy before overwriting user edits.
87. STT and diarization providers remain independently replaceable — the merge
    layer imports neither.
88. Dialogue persistence must remain replaceable with production database
    infrastructure.

Part 8 adds:

89. Raw STT and raw diarization stay **immutable** after manual edits; user
    corrections modify only the editable unified dialogue.
90. Stable speaker ids are separate from editable display names; renaming
    never changes an id, and no segment stores a copy of a name.
91. Manual speaker reassignment is authoritative downstream and is never
    re-decided by automatic assignment on load.
92. Speaker merging updates the dialogue only, keeps the target's stable id,
    and records both diarization clusters in `sourceSpeakerIds`.
93. Dialogue text edits replace the reviewed downstream text but not raw STT
    text; timestamps stay numeric seconds.
94. Segment ids stay stable and never depend on array position; split and
    merged segments record their parents.
95. Invalid timestamp edits must never persist, and timing edits stay local —
    no ripple editing, no silent adjustment of neighbours.
96. Overlap information survives manual speaker edits.
97. Unassigned and uncertain segments stay explicitly representable and
    visible.
98. Transcript, timeline and video use the same dialogue segment ids; playback
    `active` state and user `selected` state stay conceptually separate.
99. Manual edits are never automatically overwritten by regenerated STT or
    diarization; a stale baseline is surfaced, not resolved.
100. Later Translation, TTS, Timing, Mix and Export consume the **edited**
     unified dialogue.
101. The final multitrack dubbing/mixing timeline is not Part 8's timeline.
102. Dialogue editing persistence stays behind repository/service abstractions,
     and Vercel remains the web host while heavy processing stays
     external-worker-ready.

Part 9 adds:

103. Translation consumes the **current editable unified dialogue**; once a
     dialogue exists, raw STT is never translated directly.
104. `DialogueSegment.originalText` is never overwritten by a translation;
     translated text is persisted in a separate record and store.
105. Every translated segment references a stable `dialogueSegmentId`, and
     never an array position.
106. Speaker ids and timestamps are copied from the dialogue unchanged;
     translation never assigns a speaker or adjusts timing.
107. Segment structure stays **1:1** in Part 9 — no splitting, merging,
     reordering or dropping, including for empty source lines.
108. Providers implement `TranslationProvider`; vendor payloads, prompts,
     model names, credentials and retries never become the core model.
109. Provider results are matched by segment id and validated before
     persistence; missing, duplicate, unknown or empty results fail the job
     rather than producing a partial translation.
110. A translation is bound to project, source media, dialogue, dialogue
     revision and language pair; anything else makes it stale, not deleted.
111. Editing the dialogue makes existing translations stale; changing the
     default provider does not.
112. Translation runs as a `translate` processing job in the shared job
     architecture — never a second job system — and carries no source media.
113. Failed translations are retried through **new** jobs; a cancelled job
     never persists a completed translation.
114. Provider metadata, usage and confidence are optional and never
     fabricated; an unmeasured value stays absent.
115. Provider credentials stay backend/worker-only and never reach the
     browser, a stored translation or a log line.
116. Translation persistence stays behind `TranslationRepository`, with a key
     space that supports several target languages per dialogue.
117. Vercel remains the web host; translation must stay movable to an external
     worker without changing the Translate UI.
118. Part 10 builds dubbing-aware translation **on top of** this provider and
     data layer; TTS, timing, mix and export consume translations without
     modifying the source dialogue.

Part 10 adds:

119. Context-aware translation consumes the current editable unified dialogue;
     context is built from it and never from raw STT.
120. Translation context is **bounded and structured** — a configurable window,
     trimmed from the outside in, with segment ids, speakers and order intact.
121. Surrounding context improves wording only. A single-segment operation may
     never mutate a neighbouring segment, and a provider result naming a
     context-only line is rejected.
122. Segment ids, speaker ids, timestamps and source text stay unchanged by
     every translation operation; the 1:1 structure holds.
123. Providers stay behind the Part 9 abstraction; capabilities let one that
     cannot use context or dubbing constraints degrade rather than fail.
124. Natural spoken translation is preferred over literal phrasing, and meaning
     and intent take precedence over duration compression.
125. Duration compatibility is an **estimate from text**, never measured audio
     timing, and its thresholds and estimator version live in one place.
126. Duration metadata is derived and recomputed on every change to translated
     text, including manual edits.
127. Manually edited translated text is authoritative downstream and is never
     overwritten without explicit confirmation.
128. Segment regeneration and shortening replace only the targeted line, and the
     existing translation survives any failure.
129. Dialogue revision determines staleness; segment operations are blocked
     against a stale translation rather than silently rebound.
130. Segment operations carry an expected translation revision and refuse to
     overwrite a newer edit.
131. Part 9 translations migrate on read rather than being invalidated.
132. Part 11 TTS consumes the current edited translated text and may use the
     duration metadata, but must not reinterpret translation identity.
133. Full and segment-level operations share the one processing-job
     architecture; translation persistence stays provider-independent and
     replaceable.

Part 11 adds:

134. Speech generation consumes the **current edited translation**, never raw
     STT, the diarization or the dialogue's original text, and never writes to
     any of them.
135. Providers stay behind `TtsProvider` in `src/server/tts/`; model names,
     endpoints, credentials, audio formats and retries never leak into the TTS
     model, a stored record or any component. The default comes from
     `AIDUB_TTS_PROVIDER`.
136. Voice cloning is **not** implemented. `VoiceSource` carries a discriminant
     so Part 12 adds a variant rather than a rewrite, and a variant this build
     does not understand is rejected on read.
137. Aidub never selects a voice from any inferred attribute of a speaker — not
     from audio, name, diarization or transcript. A voice is a person's choice,
     and an uncast speaker stops a run.
138. Voice assignments are keyed by the stable `speakerId` and are the one
     Part 11 record that cannot be recomputed; an unreadable one is skipped, and
     never replaced with a guess.
139. Generated audio is derived. Metadata lives in `GeneratedSpeechRepository`;
     the bytes live in the shared artifact store behind `artifactId`.
140. Staleness is decided in one place by a fingerprint over text, revision,
     speaker, voice, settings, language and schema. Stale audio is surfaced,
     never deleted and never served as current.
141. A line with no speakable text is recorded as intentionally silent, by the
     same predicate the generation service uses, so it settles as current.
142. Speech generation is a `generate_speech` job in the shared job architecture
     — never a second job system — and carries no source media.
143. Blocking native synthesis runs on a worker thread; a cancelled run is
     detached rather than terminated.
144. Generated duration is **measured**, never corrected. Part 11 reports that a
     line overruns its window and does nothing else about it: no stretching, no
     compression, no rate adjustment, no moved timestamps, no retry loop.
145. A failed line keeps the audio a person already had; new audio commits before
     the take it replaces is released.
146. Artifact access is validated against the project on both the generated
     record and the artifact; no response exposes a backend filesystem path.
147. Provider credentials stay server-side and never reach the browser, a stored
     record or a log line.
148. Part 12 and later consume generated speech and its measured durations;
     alignment, mixing and export must not modify the translation, the dialogue
     or the voice assignments.
