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
- Speech-to-text lives behind `SpeechToTextProvider` in
  `src/server/transcription/`; provider JSON, credentials and model runtimes
  never leak into the transcript model or any component.
- Transcription is a `transcribe` processing job — never a second AI-job
  system — and consumes Part 4's canonical audio artifact instead of running
  FFmpeg itself.
- A transcript belongs to one project and one exact `sourceMediaId`; segment
  ids are stable, times are numeric seconds, and `originalText` must never be
  overwritten by a translation.
- Speaker diarization lives behind `SpeakerDiarizationProvider` in
  `src/server/diarization/` — a separate abstraction from
  `SpeechToTextProvider`. Never merge the two: Aidub must stay able to pair any
  STT provider with any diarization provider.
- Diarization is a `diarize` processing job and consumes Part 4's canonical
  audio artifact; it never runs its own extraction.
- Blocking native model calls run on a worker thread, never on the request
  thread, and a cancelled run is detached rather than terminated — killing a
  worker mid-call aborts the whole process.
- Provider speaker labels are normalised before persistence. Canonical ids are
  `speaker_1`, `speaker_2`, … assigned by first appearance on the timeline;
  raw labels survive only in `providerMetadata`. Speaker ids are anonymous
  clusters, never a claim about a real person.
- A diarization belongs to one project and one exact `sourceMediaId`; speaker
  and region ids are stable within a result and are read back, never
  regenerated on load.
- Speaker regions use numeric seconds, stay in timeline order, keep overlap,
  and leave silence as a gap — never a placeholder speaker.
- Part 6 must not modify transcript segments. Merging the transcript and
  speaker timelines is Part 7's job, working on normalised ids and timestamps.
- The unified dialogue in `src/types/dialogue.ts` is **derived**. Merging reads
  the raw transcript and diarization and never writes to them; both stay
  persisted so a dialogue can always be regenerated.
- Merge logic lives in `src/lib/dialogue/` as pure functions over the
  normalised Part 5/6 models. It must never import a provider, and providers
  must never assign speakers to text.
- Speaker assignment is temporal overlap aggregated per speaker. Ambiguity is
  represented explicitly (`speakerId: null` plus assignment metadata) — never
  guessed, and never resolved by array order or speaker id.
- Without word-level timings, transcript text is never split across speakers.
- Dialogue segment ids derive from transcript segment ids and stay stable once
  persisted; `mergeMetadata` records the algorithm version and thresholds.
- A dialogue is stale when its transcript, diarization, source, schema or
  algorithm version changes, and must be regenerated rather than served.
- Later parts consume the **edited** `UnifiedDialogue`, not raw STT plus
  diarization.
- Human corrections (text, speaker, timing, structure, speaker names) apply to
  the dialogue only. Raw STT and diarization stay immutable — the editor
  service cannot reach those stores, and that must stay true.
- Edit operations live in `src/lib/dialogue/dialogue-edit-operations.ts` as
  pure functions; the service only loads, persists and validates. A structural
  edit lands whole or not at all.
- Speaker ids are stable and separate from editable display names; renaming
  never changes an id and no segment stores a copy of a name.
- Manual speaker assignment is authoritative and is never re-decided by the
  merge on load; overlap metadata survives it.
- Without word timings, text is never split automatically — a person places the
  boundary.
- Segment merge requires adjacency and the same speaker; segment ids stay
  stable and never derive from array position.
- Invalid timing never persists, and timing edits are local: no ripple editing.
- Once `editMetadata.hasManualEdits` is true, new STT/diarization results must
  never overwrite the dialogue — surface the stale baseline instead.
- Playback time stays out of React state; transcript rows must not re-render on
  every frame.
- Translation consumes the **current editable `UnifiedDialogue`**, never the raw
  Part 5 transcript, and never writes to the dialogue, transcript or
  diarization. `originalText` is never overwritten by a translation.
- Translation providers live behind `TranslationProvider` in
  `src/server/translation/`; prompts, model names, credentials, payload shapes
  and per-provider retries never leak into the translation model or any
  component. The default comes from `AIDUB_TRANSLATION_PROVIDER`.
- Translation is a `translate` processing job — never a second AI-job system —
  and carries no source media: it reads the dialogue the backend already holds.
- Provider results are matched by stable `dialogueSegmentId`, never by array
  position. Missing, duplicate, unknown or empty results fail the job; nothing
  is fabricated to fill a gap.
- Part 9 translation is segment-preserving and 1:1: speaker ids and timestamps
  are copied unchanged, order comes from the dialogue, and an empty source line
  stays a line rather than being dropped or sent to a provider.
- A translation is valid only for one project, source media, dialogue, dialogue
  revision and language pair. Editing the dialogue makes it stale — surfaced,
  never deleted and never presented as current.
- Usage, provider model and confidence are recorded only where a provider
  genuinely reports them; an unmeasured value stays absent rather than zero.
- Translation context is built from the current editable dialogue by
  `src/lib/translation/translation-context-builder.ts`: bounded, structured,
  configurable in one place, and validated against the dialogue before every
  provider call. Never build context ad hoc in a component or a handler.
- Context is guidance only. A single-segment operation changes exactly one
  translated line; a provider result naming a context-only segment is rejected,
  never applied.
- Speech duration is an **estimate from text** (`duration-estimator.ts`), never
  measured audio. Its thresholds live in `duration-warning.ts` alone, and the
  estimate is recomputed on every change to translated text, manual edits
  included.
- Never claim exact duration matching, TTS timing or lip sync. Timestamps are
  never changed to fit a translation.
- Manually edited translated text is authoritative: it is what Part 11 speaks,
  and nothing overwrites it without explicit confirmation.
- Segment regeneration and shortening keep the existing translation until a new
  one is validated and stored; any failure leaves the previous text in place.
- Segment operations carry the dialogue revision and the expected translation
  revision, and refuse to write if either moved. A stale translation blocks
  segment operations rather than being silently rebound.
- No automatic re-compression loop: a line that still overruns is flagged for a
  person, never retried until it fits.
- Translation providers stay behind the Part 9 abstraction; the duration
  estimator, the context builder, the repository and the Translate components
  must never import a concrete provider.
- Never fabricate confidence: unusable provider values become `null` and stay
  in `providerMetadata`.
- Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` before
  calling work done.
