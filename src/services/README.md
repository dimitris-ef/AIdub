# Services

This directory holds Aidub's application/service layer. Two kinds of module
live here:

1. **Application services** that coordinate several data layers for one
   workflow — for example `media/project-media-service.ts`, which owns the
   source-video lifecycle across the project repository and media storage, and
   `projects/delete-project.ts`, which disposes of a project's media when the
   project is deleted.
2. **External processing clients** — the *only* place allowed to talk to
   backend or external processing infrastructure. None exist yet;
   `media/media-processing.ts` documents the contract they will implement.

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

No external processing exists yet: no transcription, translation, speech
synthesis, rendering or job APIs, and no mock stand-ins for them.
`media/media-processing.ts` is a types-and-documentation boundary — it performs
no I/O — describing how future jobs will reference stable `projectId` and
`mediaId` values through a backend client. The first real processing client
arrives with the first real workload.
