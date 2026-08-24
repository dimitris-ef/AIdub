import { redirect } from "next/navigation";

import { defaultWorkspaceSection, workspaceSectionHref } from "@/lib/navigation";

/** The workspace opens on its default section. */
export default async function ProjectPage(
  props: PageProps<"/projects/[projectId]">,
) {
  const { projectId } = await props.params;

  redirect(workspaceSectionHref(projectId, defaultWorkspaceSection));
}
