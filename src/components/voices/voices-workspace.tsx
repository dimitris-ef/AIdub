"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AudioLines,
  Captions,
  FileVideo,
  Languages,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import type { ProcessingJob, SpeechJobOperation } from "@/types/processing-job";
import { speakerDisplayName } from "@/types/dialogue";
import { getLanguageLabel } from "@/lib/languages";
import { workspaceSectionHref } from "@/lib/navigation";
import { useDialogue } from "@/hooks/use-dialogue";
import { useGeneratedSpeech } from "@/hooks/use-generated-speech";
import { useProcessingJobs } from "@/hooks/use-processing-jobs";
import { useSourceMedia } from "@/hooks/use-source-media";
import { useVoiceCatalog } from "@/hooks/use-voice-catalog";
import { ttsClient } from "@/services/tts/tts-client";
import { useProjectEditor } from "@/components/workspace/project-editor-provider";
import { useProjectWorkspace } from "@/components/workspace/project-workspace-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProcessingErrorMessage } from "@/components/processing/processing-job-status";
import { StageJobStatus } from "@/components/processing/stage-job-status";
import { GeneratedLineRow } from "@/components/voices/generated-line-row";
import { SpeakerCastList } from "@/components/voices/speaker-cast-list";
import { SpeechMessage } from "@/components/voices/speech-empty-state";

/**
 * The Voices section.
 *
 * It answers two questions — who speaks for each character, and what does the
 * dubbed line sound like? — and it knows nothing about how speech is produced:
 * not which provider runs, not whether it is a hosted API or a model on this
 * machine, not what a call costs. It starts a `generate_speech` processing job
 * and reads the persisted result back.
 *
 * The input is the **current translation** from Parts 9 and 10, which is why
 * this page requires the Translate step: the reviewed, edited text is the thing
 * worth speaking, and a manual correction someone made is what gets spoken.
 *
 * What this screen does not do, deliberately: it does not clone anyone's voice,
 * does not align generated speech to the original timing, does not mix anything
 * with the source audio, and does not export a dubbed video. It generates
 * speech, plays it against the original, and reports where a line runs long.
 */
export function VoicesWorkspace() {
  const { project, isLoading: isProjectLoading } = useProjectWorkspace();
  const { status: mediaStatus, media } = useSourceMedia(project);
  const { jobs, error: jobError, pendingType, startJob, cancelJob } =
    useProcessingJobs(project, media);
  const { selectedSegmentId, selectSegment, seek, play } = useProjectEditor();
  const [assigning, setAssigning] = useState<string | null>(null);

  const speechJobs = jobs.filter((job) => job.type === "generate_speech");
  const activeJob = speechJobs.find(
    (job) => job.status === "queued" || job.status === "processing",
  );
  const latestJob: ProcessingJob | undefined = speechJobs[0];
  const completedJobId = speechJobs.find(
    (job) => job.status === "completed",
  )?.id;

  // Speaker display names live on the dialogue; nothing here keeps a copy.
  const { dialogue } = useDialogue(project?.id ?? null, media?.id ?? null);
  const targetLanguage = project?.targetLanguage ?? null;

  const {
    status: speechStatus,
    speech,
    error: speechError,
    reload: reloadSpeech,
  } = useGeneratedSpeech(project?.id ?? null, media?.id ?? null, targetLanguage, {
    revision: completedJobId ?? "",
  });

  const {
    available: providerAvailable,
    voices,
    status: voicesStatus,
  } = useVoiceCatalog(targetLanguage);

  if (isProjectLoading || !project || mediaStatus === "loading") {
    return <VoicesSkeleton />;
  }

  const isPending = pendingType === "generate_speech";
  const isBusy = Boolean(activeJob) || isPending;
  const activeSegmentId =
    activeJob?.parameters?.kind === "generate_speech"
      ? (activeJob.parameters.dialogueSegmentId ?? null)
      : null;

  async function startSpeechJob(
    operation: SpeechJobOperation,
    dialogueSegmentId?: string,
  ) {
    if (!speech?.translationId || !speech.dialogueId || !targetLanguage) {
      return;
    }

    const started = await startJob("generate_speech", {
      kind: "generate_speech",
      operation,
      // The job names the exact translation and revision it was created for, so
      // audio produced against text that has since changed is rejected rather
      // than stored as current.
      dialogueId: speech.dialogueId,
      translationId: speech.translationId,
      translationRevision: speech.translationRevision ?? 0,
      targetLanguage,
      dialogueSegmentId: dialogueSegmentId ?? null,
      // A single-line action is always an explicit "do this again"; a full run
      // speaks only what actually needs speaking.
      regenerateAll: operation === "single_segment",
    });

    if (started) {
      toast.success(
        operation === "single_segment"
          ? "Regenerating line"
          : "Generating speech",
      );
    }
  }

  async function assignVoice(speakerId: string, voiceId: string) {
    if (!project || !media || !speech?.dialogueId || !targetLanguage) {
      return;
    }

    setAssigning(speakerId);

    try {
      await ttsClient.assignVoice(
        {
          projectId: project.id,
          sourceMediaId: media.id,
          dialogueId: speech.dialogueId,
          targetLanguage,
        },
        speakerId,
        { providerId: voices.find((v) => v.id === voiceId)?.providerId ?? "", voiceId },
      );
      reloadSpeech();
      toast.success("Voice assigned");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "The voice could not be assigned.",
      );
    } finally {
      setAssigning(null);
    }
  }

  async function previewVoice(voiceId: string): Promise<string | null> {
    const voice = voices.find((entry) => entry.id === voiceId);

    if (!voice || !targetLanguage) {
      return null;
    }

    try {
      const blob = await ttsClient.previewVoice(
        { providerId: voice.providerId, voiceId: voice.id },
        targetLanguage,
      );

      return URL.createObjectURL(blob);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "The voice could not be previewed.",
      );
      return null;
    }
  }

  function playOriginal(startTime: number) {
    seek(startTime);
    play();
  }

  const speakerNames = new Map(
    (dialogue?.speakers ?? []).map((speaker) => [
      speaker.id,
      speakerDisplayName(dialogue?.speakers ?? [], speaker.id),
    ]),
  );
  const lineCounts = new Map<string, number>();

  for (const segment of speech?.segments ?? []) {
    if (segment.speakerId) {
      lineCounts.set(
        segment.speakerId,
        (lineCounts.get(segment.speakerId) ?? 0) + 1,
      );
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <VoicesHeader />
        {speech?.translationId ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {getLanguageLabel(project.targetLanguage)}
            </span>
            <Button
              size="sm"
              // The two things the backend will refuse a run for. Offering a
              // button that is known to fail wastes a minute of someone's time
              // to tell them what this screen already knows.
              disabled={
                isBusy ||
                speech.unassignedSpeakerIds.length > 0 ||
                speech.hasUnassignedSegments ||
                speech.state === "translation_stale"
              }
              onClick={() => void startSpeechJob("full_project")}
            >
              <AudioLines aria-hidden />
              {isPending
                ? "Starting…"
                : speech.currentCount > 0
                  ? "Update speech"
                  : "Generate speech"}
            </Button>
          </div>
        ) : null}
      </div>

      {jobError ? <ProcessingErrorMessage message={jobError} /> : null}

      {!media ? (
        <SpeechMessage
          icon={<FileVideo className="size-5" aria-hidden />}
          title="No source video yet"
          description="Add a source video, review its transcript and translate it before generating voices."
          actions={
            <Button asChild size="sm">
              <Link href={workspaceSectionHref(project.id, "media")}>
                Go to Media
              </Link>
            </Button>
          }
        />
      ) : speechStatus === "loading" || voicesStatus === "loading" ? (
        <VoicesSkeleton />
      ) : speechStatus === "error" ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {speechError ?? "The generated speech could not be loaded."}
          </p>
          <Button variant="outline" size="sm" onClick={reloadSpeech}>
            <RotateCcw aria-hidden />
            Try again
          </Button>
        </div>
      ) : !speech || speech.state === "translation_required" ? (
        <SpeechMessage
          icon={<Languages className="size-5" aria-hidden />}
          title="Translation is required"
          description="Voices speak the reviewed translation, not the original dialogue. Translate this project before generating speech."
          actions={
            <Button asChild size="sm">
              <Link href={workspaceSectionHref(project.id, "translate")}>
                Go to Translate
              </Link>
            </Button>
          }
        />
      ) : !providerAvailable ? (
        // A real answer, not an error: this server has no speech provider set
        // up, and no amount of clicking here will change that.
        <SpeechMessage
          icon={<AudioLines className="size-5" aria-hidden />}
          title="No speech provider is configured"
          description="This server has no text-to-speech provider available, so voices cannot be generated. Assignments you make are still kept."
        />
      ) : (
        <>
          {speech.state === "translation_stale" ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                The translation is out of date. Update it in Translate before
                generating speech — otherwise the voices would speak lines
                nobody currently has.
              </span>
            </p>
          ) : null}

          {speech.hasUnassignedSegments ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Some lines have no speaker, so nothing says which voice should
                read them. Assign them in{" "}
                <Link
                  className="underline"
                  href={workspaceSectionHref(project.id, "transcript")}
                >
                  Transcript
                </Link>
                .
              </span>
            </p>
          ) : null}

          {dialogue ? (
            <SpeakerCastList
              speakers={dialogue.speakers}
              voices={voices}
              assignments={speech.assignments}
              lineCounts={lineCounts}
              busy={isBusy}
              pendingSpeakerId={assigning}
              onAssign={(speakerId, voiceId) =>
                void assignVoice(speakerId, voiceId)
              }
              onPreview={previewVoice}
            />
          ) : (
            <SpeechMessage
              icon={<Captions className="size-5" aria-hidden />}
              title="Transcript review is required"
              description="Speaker names come from the reviewed dialogue. Complete transcript review to cast voices."
            />
          )}

          {activeJob ? (
            <StageJobStatus
              job={activeJob}
              title={
                activeSegmentId ? "Regenerating line" : "Generating speech"
              }
              onCancel={() => void cancelJob(activeJob.id)}
            />
          ) : null}

          {!activeJob && latestJob?.status === "failed" ? (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <p role="alert" className="text-sm text-destructive">
                {latestJob.error?.message ??
                  "Speech generation failed for this project."}
              </p>
              {speech.currentCount > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Previously generated audio is still available below.
                </p>
              ) : null}
            </div>
          ) : null}

          {speech.unassignedSpeakerIds.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {speech.unassignedSpeakerIds.length}{" "}
              {speech.unassignedSpeakerIds.length === 1
                ? "speaker still needs"
                : "speakers still need"}{" "}
              a voice before speech can be generated.
            </p>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h3
                id="dubbed-lines-heading"
                className="text-sm font-semibold tracking-tight"
              >
                Dubbed lines
              </h3>
              <p className="text-xs text-muted-foreground">
                {speech.currentCount} of {speech.segments.length} up to date
                {speech.staleCount > 0 ? ` · ${speech.staleCount} to update` : ""}
              </p>
            </div>

            <ul
              aria-labelledby="dubbed-lines-heading"
              className="divide-y divide-border rounded-lg border border-border"
            >
              {speech.segments.map((segment) => (
                <GeneratedLineRow
                  key={segment.dialogueSegmentId}
                  segment={segment}
                  speakerName={
                    segment.speakerId
                      ? (speakerNames.get(segment.speakerId) ?? null)
                      : null
                  }
                  selected={selectedSegmentId === segment.dialogueSegmentId}
                  busy={isBusy}
                  generating={activeSegmentId === segment.dialogueSegmentId}
                  audioUrl={
                    segment.generated?.artifactId
                      ? ttsClient.audioUrl(project.id, segment.generated.id)
                      : null
                  }
                  onSelect={() => {
                    selectSegment(segment.dialogueSegmentId);
                    seek(segment.startTime);
                  }}
                  onPlayOriginal={() => playOriginal(segment.startTime)}
                  onRegenerate={() =>
                    void startSpeechJob(
                      "single_segment",
                      segment.dialogueSegmentId,
                    )
                  }
                />
              ))}
            </ul>
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Generated speech is stored for this translation revision, voice and
        settings. Editing a line, recasting a speaker or changing the target
        language makes its audio out of date rather than deleting it. Part 11
        does not align speech to the original timing or mix it with the source
        audio.
      </p>
    </section>
  );
}

function VoicesHeader() {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold tracking-tight">Voices</h2>
      <p className="text-sm text-muted-foreground">
        Cast a voice for each speaker and generate the dubbed dialogue.
      </p>
    </div>
  );
}

function VoicesSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
