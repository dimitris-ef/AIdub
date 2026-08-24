import {
  AudioLines,
  Captions,
  Clapperboard,
  Download,
  FolderOpen,
  Languages,
  Settings,
  SlidersHorizontal,
} from "lucide-react";

import type {
  PrimaryNavItem,
  WorkspaceSection,
  WorkspaceSectionSlug,
} from "@/types/navigation";

/** Global navigation shown in the application shell. */
export const primaryNavItems: readonly PrimaryNavItem[] = [
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * Workspace sections. These are real routes so that every section is
 * deep-linkable and browser navigation keeps working; they are never swapped
 * through component state.
 */
export const workspaceSections: readonly WorkspaceSection[] = [
  {
    slug: "media",
    label: "Media",
    icon: Clapperboard,
    summary: "Import and manage the video or audio being dubbed.",
  },
  {
    slug: "transcript",
    label: "Transcript",
    icon: Captions,
    summary: "Review speech transcription and editable dialogue.",
  },
  {
    slug: "translate",
    label: "Translate",
    icon: Languages,
    summary: "Work on translated dialogue for the target language.",
  },
  {
    slug: "voices",
    label: "Voices",
    icon: AudioLines,
    summary: "Assign detected speakers to synthetic or cloned voices.",
  },
  {
    slug: "mix",
    label: "Mix",
    icon: SlidersHorizontal,
    summary: "Balance original audio against generated dubbed speech.",
  },
  {
    slug: "export",
    label: "Export",
    icon: Download,
    summary: "Configure and render the finished dubbed media.",
  },
];

export const defaultWorkspaceSection: WorkspaceSectionSlug = "media";

export function workspaceSectionHref(
  projectId: string,
  slug: WorkspaceSectionSlug,
): string {
  return `/projects/${encodeURIComponent(projectId)}/${slug}`;
}

export function getWorkspaceSection(
  slug: WorkspaceSectionSlug,
): WorkspaceSection {
  const section = workspaceSections.find((item) => item.slug === slug);

  if (!section) {
    throw new Error(`Unknown workspace section: ${slug}`);
  }

  return section;
}
