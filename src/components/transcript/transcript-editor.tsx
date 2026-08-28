"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

import type { DialogueSegment, UnifiedDialogue } from "@/types/dialogue";
import type { ProjectMedia } from "@/types/media";
import type { DialogueEdit } from "@/services/dialogue/dialogue-client";
import { sortSegments } from "@/lib/dialogue/dialogue-edit-operations";
import { useDialogueEditor } from "@/hooks/use-dialogue-editor";
import {
  useMediaDuration,
  usePlaybackTime,
  useProjectEditor,
} from "@/components/workspace/project-editor-provider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DialogueTimeline } from "@/components/timeline/dialogue-timeline";
import { EditableDialogueRow } from "@/components/transcript/editable-dialogue-row";
import { SpeakerManager } from "@/components/transcript/speaker-manager";
import { SplitSegmentDialog } from "@/components/transcript/split-segment-dialog";

/**
 * The transcript and speaker editor.
 *
 * This is where Part 7's generated dialogue becomes a document a person can
 * correct: text, speaker, timing and segment structure, all against the
 * editable dialogue and never against the raw transcript or diarization.
 *
 * Video, transcript and timeline share one selection and one set of stable
 * segment ids, so clicking anywhere moves everything else. Playback drives a
 * separate *active* segment, which is why the video advancing never pulls
 * focus out of a line someone is typing in.
 */
export function TranscriptEditor({
  projectId,
  media,
  dialogue: loaded,
  onReload,
  staleBaseline,
  playerSlot,
  sidebarSlot,
}: {
  projectId: string;
  media: ProjectMedia | null;
  dialogue: UnifiedDialogue;
  onReload: () => void;
  staleBaseline?: { reason: string } | undefined;
  /** The source-video player, laid out beside the dialogue. */
  playerSlot: ReactNode;
  /** Raw transcription and speaker-analysis panels, kept inspectable. */
  sidebarSlot: ReactNode;
}) {
  const {
    dialogue,
    saveStatus,
    saveError,
    newOverlaps,
    applyEdit,
    dismissError,
  } = useDialogueEditor(projectId, media?.id ?? null, loaded);
  const { selectedSegmentId, activeSegmentId, selectSegment, seek } =
    useProjectEditor();
  const mediaDuration = useMediaDuration();
  const [splitSegmentId, setSplitSegmentId] = useState<string | null>(null);

  const segments = useMemo(
    () => sortSegments(dialogue?.segments ?? []),
    [dialogue?.segments],
  );
  const speakers = dialogue?.speakers ?? [];
  const busy = saveStatus === "saving";

  const selectAndSeek = useCallback(
    (segment: DialogueSegment) => {
      selectSegment(segment.id);
      // Seek, never autoplay: a click is a request to look at a line, not to
      // start the video.
      seek(segment.startTime);
    },
    [seek, selectSegment],
  );

  const edit = useCallback(
    (operation: DialogueEdit) => void applyEdit(operation),
    [applyEdit],
  );

  const splitSegment = segments.find(
    (segment) => segment.id === splitSegmentId,
  );

  if (!dialogue) {
    return null;
  }

  return (
    <div className="space-y-4">
      <ActiveSegmentTracker segments={segments} />

      {staleBaseline ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            New transcription or speaker-analysis results are available, but
            this dialogue contains manual corrections, so it has been kept as it
            is. Reconciling the two is not automatic.
          </span>
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          {playerSlot}
          {sidebarSlot}
        </div>

        <section
          aria-labelledby="dialogue-heading"
          className="space-y-3 rounded-lg border border-border bg-card/40 p-4 lg:p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h3
                id="dialogue-heading"
                className="text-sm font-semibold tracking-tight"
              >
                Dialogue
              </h3>
              <p className="text-sm text-muted-foreground">
                Review and correct who said what, and when. Corrections are
                saved here and never change the transcription or speaker
                analysis underneath.
              </p>
            </div>

            <SaveIndicator
              status={saveStatus}
              revision={dialogue.editMetadata.revision}
            />
          </div>

          <SpeakerManager
            speakers={speakers}
            segments={segments}
            disabled={busy}
            onRename={(speakerId, name) =>
              edit({ type: "rename_speaker", speakerId, name })
            }
            onMerge={(sourceSpeakerId, targetSpeakerId) =>
              edit({ type: "merge_speakers", sourceSpeakerId, targetSpeakerId })
            }
          />

          {saveError ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <p role="alert" className="text-sm text-destructive">
                {saveError}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  dismissError();
                  onReload();
                }}
              >
                <RotateCcw aria-hidden />
                Reload
              </Button>
            </div>
          ) : null}

          {newOverlaps.length > 0 ? (
            <p role="status" className="text-xs text-muted-foreground">
              That timing change created a new overlap between lines.
              Overlapping dialogue is allowed — nothing was adjusted for you.
            </p>
          ) : null}

          <Separator />

          <p className="text-xs text-muted-foreground">
            {segments.length} {segments.length === 1 ? "line" : "lines"}
            {dialogue.mergeMetadata.unassignedSegmentCount > 0
              ? ` · ${segments.filter((s) => s.speakerId === null).length} unassigned`
              : ""}{" "}
            · {dialogue.mergeMetadata.algorithmVersion}
            {dialogue.editMetadata.hasManualEdits
              ? ` · revision ${dialogue.editMetadata.revision}`
              : ""}
          </p>

          {segments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No dialogue was detected in this source.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {segments.map((segment, index) => (
                <EditableDialogueRow
                  key={segment.id}
                  segment={segment}
                  speakers={speakers}
                  selected={segment.id === selectedSegmentId}
                  active={segment.id === activeSegmentId}
                  busy={busy}
                  mediaDuration={mediaDuration}
                  canMergeWithPrevious={
                    index > 0 &&
                    segments[index - 1].speakerId === segment.speakerId
                  }
                  onSelect={() => selectAndSeek(segment)}
                  onTextCommit={(text) =>
                    edit({ type: "update_text", segmentId: segment.id, text })
                  }
                  onSpeakerChange={(speakerId) =>
                    edit({
                      type: "reassign_speaker",
                      segmentId: segment.id,
                      speakerId,
                    })
                  }
                  onTimingChange={(startTime, endTime) =>
                    edit({
                      type: "update_timing",
                      segmentId: segment.id,
                      startTime,
                      endTime,
                      mediaDuration: mediaDuration || null,
                    })
                  }
                  onSplit={() => {
                    selectSegment(segment.id);
                    setSplitSegmentId(segment.id);
                  }}
                  onMergeWithPrevious={() =>
                    edit({
                      type: "merge_segments",
                      firstSegmentId: segments[index - 1].id,
                      secondSegmentId: segment.id,
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <DialogueTimeline
        segments={segments}
        speakers={speakers}
        onResize={(segmentId, startTime, endTime) =>
          edit({
            type: "update_timing",
            segmentId,
            startTime,
            endTime,
            mediaDuration: mediaDuration || null,
          })
        }
      />

      <SplitAtPlayhead
        segment={splitSegment ?? null}
        speakers={speakers}
        pending={busy}
        open={splitSegmentId !== null}
        onOpenChange={(open) => setSplitSegmentId(open ? splitSegmentId : null)}
        onConfirm={(input) => {
          if (splitSegment) {
            edit({
              type: "split_segment",
              segmentId: splitSegment.id,
              splitTime: input.splitTime,
              firstText: input.firstText,
              secondText: input.secondText,
              firstSpeakerId: input.firstSpeakerId,
              secondSpeakerId: input.secondSpeakerId,
            });
          }
          setSplitSegmentId(null);
        }}
      />
    </div>
  );
}

/**
 * Reads the playhead and marks the line under it.
 *
 * It lives in its own component so the frame-rate time updates it subscribes
 * to re-render this and nothing else; the rows above only re-render when the
 * active id actually changes.
 */
function ActiveSegmentTracker({
  segments,
}: {
  segments: readonly DialogueSegment[];
}) {
  const { currentTime } = usePlaybackTime();
  const { activeSegmentId, setActiveSegmentId } = useProjectEditor();

  const current =
    segments.find(
      (segment) =>
        segment.startTime <= currentTime && currentTime < segment.endTime,
    )?.id ?? null;

  useEffect(() => {
    if (current !== activeSegmentId) {
      setActiveSegmentId(current);
    }
  }, [current, activeSegmentId, setActiveSegmentId]);

  return (
    <span
      className="sr-only"
      data-testid="active-segment"
      data-id={current ?? ""}
    >
      {current ? `Playing line ${current}` : "No line is playing"}
    </span>
  );
}

/** Passes the live playhead into the split dialog. */
function SplitAtPlayhead({
  segment,
  speakers,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  segment: DialogueSegment | null;
  speakers: UnifiedDialogue["speakers"];
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: {
    splitTime: number;
    firstText: string;
    secondText: string;
    firstSpeakerId: string | null;
    secondSpeakerId: string | null;
  }) => void;
}) {
  const { currentTime } = usePlaybackTime();

  return (
    <SplitSegmentDialog
      segment={segment}
      speakers={speakers}
      splitTime={currentTime}
      open={open}
      pending={pending}
      onOpenChange={onOpenChange}
      onConfirm={(input) => onConfirm({ ...input, splitTime: currentTime })}
    />
  );
}

function SaveIndicator({
  status,
  revision,
}: {
  status: "idle" | "saving" | "saved" | "error";
  revision: number;
}) {
  const label =
    status === "saving"
      ? "Saving…"
      : status === "error"
        ? "Save failed"
        : status === "saved"
          ? "Saved"
          : revision > 0
            ? "Saved"
            : "No changes";

  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="save-status"
      className={
        status === "error"
          ? "text-xs text-destructive"
          : "text-xs text-muted-foreground"
      }
    >
      {label}
    </p>
  );
}
