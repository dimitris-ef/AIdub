import type { Metadata } from "next";

import { WorkspaceSectionPlaceholder } from "@/components/workspace/workspace-section-placeholder";

export const metadata: Metadata = {
  title: "Export",
};

const planned = [
  "Output format and codec presets",
  "Subtitle and audio track options",
  "Render jobs on external infrastructure",
  "Download of the finished dubbed media",
];

export default function ExportPage() {
  return <WorkspaceSectionPlaceholder slug="export" planned={planned} />;
}
