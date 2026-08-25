import type { Metadata } from "next";

import { ProjectsDashboard } from "@/components/projects/projects-dashboard";

export const metadata: Metadata = {
  title: "Projects",
};

export default function ProjectsPage() {
  return (
    <div className="flex flex-1 flex-col p-4 lg:p-8">
      <ProjectsDashboard />
    </div>
  );
}
