import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { MediaStageSlot } from "@/components/workspace/media-stage-slot";
import { TimelineSlot } from "@/components/workspace/timeline-slot";

/**
 * Shared project workspace layout.
 *
 *   WorkspaceHeader (project context + section navigation)
 *   MediaStageSlot  (reserved for the future persistent player)
 *   children        (the active workspace section)
 *   TimelineSlot    (reserved for the future dubbing timeline)
 *
 * Everything a future part needs to keep alive across sections — playback
 * state, timeline state, selection — belongs at this level. Sections stay
 * route-based, so navigating between them swaps only `children`.
 */
export default async function ProjectWorkspaceLayout(
  props: LayoutProps<"/projects/[projectId]">,
) {
  const { projectId } = await props.params;

  return (
    <div className="flex flex-1 flex-col">
      <WorkspaceHeader projectId={projectId} />

      <div className="flex flex-1 flex-col gap-5 p-4 lg:p-6 xl:flex-row xl:gap-6">
        <MediaStageSlot className="xl:w-[24rem] xl:shrink-0" />
        <div className="min-w-0 flex-1">{props.children}</div>
      </div>

      <TimelineSlot />
    </div>
  );
}
