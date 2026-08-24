import type { LucideIcon } from "lucide-react";

/** A destination in Aidub's global (application-level) navigation. */
export type PrimaryNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/** The URL segment of a section inside a project workspace. */
export type WorkspaceSectionSlug =
  | "media"
  | "transcript"
  | "translate"
  | "voices"
  | "mix"
  | "export";

/** A section of the project workspace, rendered as a route. */
export type WorkspaceSection = {
  slug: WorkspaceSectionSlug;
  label: string;
  icon: LucideIcon;
  /** Short description of what the section will eventually own. */
  summary: string;
};
