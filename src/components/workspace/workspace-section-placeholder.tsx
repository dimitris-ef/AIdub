import { getWorkspaceSection } from "@/lib/navigation";
import type { WorkspaceSectionSlug } from "@/types/navigation";
import { Separator } from "@/components/ui/separator";
import { PlaceholderBadge } from "@/components/layout/placeholder-badge";

type WorkspaceSectionPlaceholderProps = {
  slug: WorkspaceSectionSlug;
  /** What this section will own once the corresponding part is built. */
  planned: readonly string[];
};

/** Shared body for the workspace sections until each one is implemented. */
export function WorkspaceSectionPlaceholder({
  slug,
  planned,
}: WorkspaceSectionPlaceholderProps) {
  const { label, icon: Icon, summary } = getWorkspaceSection(slug);

  return (
    <section className="rounded-lg border border-border bg-card/40 p-5 lg:p-6">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold tracking-tight">{label}</h2>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>
        <PlaceholderBadge className="ml-auto" />
      </div>

      <Separator className="my-5" />

      <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Planned for later parts
      </h3>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {planned.map((item) => (
          <li
            key={item}
            className="flex items-start gap-2.5 text-sm text-muted-foreground"
          >
            <span
              aria-hidden
              className="mt-2 size-1 shrink-0 rounded-full bg-primary/70"
            />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
