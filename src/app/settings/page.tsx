import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PlaceholderBadge } from "@/components/layout/placeholder-badge";

export const metadata: Metadata = {
  title: "Settings",
};

const plannedSettings = [
  {
    title: "Account",
    description: "Profile and sign-in details, once accounts exist.",
  },
  {
    title: "AI providers",
    description:
      "Credentials and model choices for transcription, translation and speech synthesis.",
  },
  {
    title: "Project defaults",
    description: "Default source and target languages for new projects.",
  },
  {
    title: "Audio",
    description: "Loudness targets and how original audio is ducked under dubs.",
  },
  {
    title: "Export defaults",
    description: "Container, codec and quality presets used when rendering.",
  },
  {
    title: "Processing infrastructure",
    description:
      "Endpoints for the external services that will run media and AI workloads.",
  },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <PageHeader
          title="Settings"
          description="Aidub configuration will live here. Nothing on this page is configurable yet."
        />

        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/40">
          {plannedSettings.map(({ title, description }) => (
            <li
              key={title}
              className="flex items-start justify-between gap-4 px-4 py-3.5"
            >
              <div className="space-y-1">
                <h2 className="text-sm font-medium">{title}</h2>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
              <PlaceholderBadge />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
