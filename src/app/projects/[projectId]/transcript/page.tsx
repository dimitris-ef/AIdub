import type { Metadata } from "next";

import { WorkspaceSectionPlaceholder } from "@/components/workspace/workspace-section-placeholder";

export const metadata: Metadata = {
  title: "Transcript",
};

const planned = [
  "Speech transcription of the source audio",
  "Editable dialogue segments with timings",
  "Detected speakers per segment",
  "Selection synchronised with the player",
];

export default function TranscriptPage() {
  return <WorkspaceSectionPlaceholder slug="transcript" planned={planned} />;
}
