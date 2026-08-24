import type { Metadata } from "next";

import { WorkspaceSectionPlaceholder } from "@/components/workspace/workspace-section-placeholder";

export const metadata: Metadata = {
  title: "Voices",
};

const planned = [
  "Voice assignment per detected speaker",
  "Synthetic voice library",
  "Cloned voices from source speakers",
  "Per-speaker delivery settings",
];

export default function VoicesPage() {
  return <WorkspaceSectionPlaceholder slug="voices" planned={planned} />;
}
