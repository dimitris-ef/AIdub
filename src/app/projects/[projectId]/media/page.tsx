import type { Metadata } from "next";

import { WorkspaceSectionPlaceholder } from "@/components/workspace/workspace-section-placeholder";

export const metadata: Metadata = {
  title: "Media",
};

const planned = [
  "Video and audio import",
  "Source media details and duration",
  "Original audio track inspection",
  "Waveform generation on external workers",
];

export default function MediaPage() {
  return <WorkspaceSectionPlaceholder slug="media" planned={planned} />;
}
