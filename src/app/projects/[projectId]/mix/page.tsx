import type { Metadata } from "next";

import { WorkspaceSectionPlaceholder } from "@/components/workspace/workspace-section-placeholder";

export const metadata: Metadata = {
  title: "Mix",
};

const planned = [
  "Levels for original and dubbed audio",
  "Ducking of the original dialogue",
  "Music and effects handling",
  "Preview of the mixed result",
];

export default function MixPage() {
  return <WorkspaceSectionPlaceholder slug="mix" planned={planned} />;
}
