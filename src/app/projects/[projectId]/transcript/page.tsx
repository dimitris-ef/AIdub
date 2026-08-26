import type { Metadata } from "next";

import { TranscriptWorkspace } from "@/components/transcript/transcript-workspace";

export const metadata: Metadata = {
  title: "Transcript",
};

export default function TranscriptPage() {
  return <TranscriptWorkspace />;
}
