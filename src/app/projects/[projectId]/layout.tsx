import { ProjectEditorProvider } from "@/components/workspace/project-editor-provider";
import { ProjectWorkspaceProvider } from "@/components/workspace/project-workspace-provider";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

/**
 * Shared project workspace layout.
 *
 * The provider resolves `[projectId]` once and shares it with every section;
 * `WorkspaceShell` owns the chrome plus the reserved slots for the persistent
 * player and dubbing timeline. Sections stay route-based, so navigating
 * between them swaps only `children` — the shell and the shared playback and
 * selection state stay mounted.
 *
 * `ProjectEditorProvider` is that shared state. Transcript is its first
 * consumer; Translate, Voices, Mix and Export can read the same playhead and
 * selection without each rebuilding their own player wiring.
 */
export default async function ProjectWorkspaceLayout(
  props: LayoutProps<"/projects/[projectId]">,
) {
  const { projectId } = await props.params;

  return (
    <ProjectWorkspaceProvider projectId={projectId}>
      <ProjectEditorProvider>
        <WorkspaceShell>{props.children}</WorkspaceShell>
      </ProjectEditorProvider>
    </ProjectWorkspaceProvider>
  );
}
