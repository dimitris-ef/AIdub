# Services

This directory is the **only** place allowed to talk to backend or external
processing infrastructure.

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

## Status in Part 1

Empty on purpose. Part 1 implements no transcription, translation, speech
synthesis, rendering, storage or job APIs, and no mock stand-ins for them.
The first real service module arrives with the first real workload.
