import type { Metadata } from "next";

import { WorkspaceSectionPlaceholder } from "@/components/workspace/workspace-section-placeholder";

export const metadata: Metadata = {
  title: "Translate",
};

const planned = [
  "Target language selection",
  "Machine translation of each segment",
  "Manual editing of translated lines",
  "Timing fit against the original delivery",
];

export default function TranslatePage() {
  return <WorkspaceSectionPlaceholder slug="translate" planned={planned} />;
}
