import { ProjectWorkspaceProvider } from "@/components/workspace/project-workspace-provider";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

/**
 * Shared project workspace layout.
 *
 * The provider resolves `[projectId]` once and shares it with every section;
 * `WorkspaceShell` owns the chrome plus the reserved slots for the future
 * persistent player and dubbing timeline. Sections stay route-based, so
 * navigating between them swaps only `children` — the shell, and later the
 * player and timeline state it holds, stay mounted.
 */
export default async function ProjectWorkspaceLayout(
  props: LayoutProps<"/projects/[projectId]">,
) {
  const { projectId } = await props.params;

  return (
    <ProjectWorkspaceProvider projectId={projectId}>
      <WorkspaceShell>{props.children}</WorkspaceShell>
    </ProjectWorkspaceProvider>
  );
}
