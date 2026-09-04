import type { Metadata } from "next";

import { VoicesWorkspace } from "@/components/voices/voices-workspace";

export const metadata: Metadata = {
  title: "Voices",
};

export default function VoicesPage() {
  return <VoicesWorkspace />;
}
