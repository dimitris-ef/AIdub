import type { Metadata } from "next";

import { MediaWorkspace } from "@/components/media/media-workspace";

export const metadata: Metadata = {
  title: "Media",
};

export default function MediaPage() {
  return <MediaWorkspace />;
}
