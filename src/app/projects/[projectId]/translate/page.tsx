import type { Metadata } from "next";

import { TranslateWorkspace } from "@/components/translate/translate-workspace";

export const metadata: Metadata = {
  title: "Translate",
};

export default function TranslatePage() {
  return <TranslateWorkspace />;
}
