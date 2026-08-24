import { workspaceSectionHref, workspaceSections } from "@/lib/navigation";
import { NavLink } from "@/components/navigation/nav-link";

/**
 * Workspace sections are routes, not component state, so every section is
 * deep-linkable and browser history behaves as users expect.
 */
export function WorkspaceSectionNav({ projectId }: { projectId: string }) {
  return (
    <nav
      aria-label="Workspace sections"
      className="overflow-x-auto border-t border-border px-2"
    >
      <ul className="flex min-w-max items-center gap-0.5">
        {workspaceSections.map(({ slug, label, icon: Icon }) => (
          <li key={slug}>
            <NavLink
              href={workspaceSectionHref(projectId, slug)}
              className="relative flex items-center gap-2 rounded-t-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[active=true]:text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent data-[active=true]:after:bg-primary"
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
