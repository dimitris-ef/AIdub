import type { Project } from "@/types/project";
import { ProjectCard } from "@/components/projects/project-card";

export function ProjectList({
  projects,
  onRename,
  onDelete,
}: {
  projects: readonly Project[];
  onRename: (project: Project) => void;
  onDelete: (project: Project) => void;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <li key={project.id} className="flex">
          <ProjectCard
            project={project}
            onRename={onRename}
            onDelete={onDelete}
          />
        </li>
      ))}
    </ul>
  );
}
