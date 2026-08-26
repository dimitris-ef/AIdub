# Services

This directory holds Aidub's application/service layer. Two kinds of module
live here:

1. **Application services** that coordinate several data layers for one
   workflow — for example `media/project-media-service.ts`, which owns the
   source-video lifecycle across the project repository and media storage, and
   `projects/delete-project.ts`, which disposes of a project's media when the
   project is deleted.
2. **Backend/processing clients** — the *only* place allowed to talk to
   backend or external processing infrastructure. `processing/processing-client.ts`
   is the first one: it speaks the processing job contract
   (`/api/processing/*`) and knows nothing about FFmpeg.
   `media/media-processing.ts` still documents the shape future AI job clients
   will take.

## Why it exists

Aidub's heavy work — FFmpeg pipelines, waveform generation, transcription,
diarization, translation inference, TTS, voice cloning, GPU jobs — will not run
inside Vercel serverless functions. It will run on external compute (dedicated
services, containers, background workers, GPU workers, managed inference APIs).

The web application therefore has to reach those systems across a network
boundary. Keeping that boundary explicit means:

- React components never contain fetch calls, endpoint URLs, polling loops or
  media-processing assumptions;
- request/response shapes for a workload are defined in one place;
- the transport (REST, queue, signed upload, websocket) can change without
  touching the UI;
- it stays obvious which parts of Aidub are implemented and which are not.

## The rule

> UI components and route handlers call functions exported from `src/services/*`.
> They never call an external processing API directly.

A future service module looks like this — one module per external capability,
plain typed functions in, typed results out:

```
src/services/
  transcription.ts   // startTranscription(), getTranscriptionStatus()
  translation.ts
  speech.ts
  render.ts
```

## Status

Media processing is real as of Part 4: `processing/processing-client.ts` creates,
reads and cancels jobs served by `src/app/api/processing/*`, which run FFprobe
inspection and canonical audio extraction through `src/server/processing/`.

Speech-to-text is real as of Part 5: the same processing client creates
`transcribe` jobs, and `transcription/transcript-client.ts` reads the stored
transcript back. Providers, credentials and model runtimes stay in
`src/server/transcription/`.

Still absent: diarization, source separation, translation, speech synthesis and
rendering — with no mock stand-ins. Those stages consume transcripts and
processing artifacts through this same job architecture.
