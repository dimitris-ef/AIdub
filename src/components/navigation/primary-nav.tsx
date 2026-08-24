import { primaryNavItems } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { NavLink } from "@/components/navigation/nav-link";

type PrimaryNavProps = {
  orientation?: "vertical" | "horizontal";
  className?: string;
};

/**
 * Global navigation. Rendered on the server; only the individual links cross
 * the client boundary (they need the current pathname for active state).
 */
export function PrimaryNav({
  orientation = "vertical",
  className,
}: PrimaryNavProps) {
  const isVertical = orientation === "vertical";

  return (
    <ul
      className={cn(
        "flex gap-1",
        isVertical ? "flex-col" : "flex-row items-center",
        className,
      )}
    >
      {primaryNavItems.map(({ href, label, icon: Icon }) => (
        <li key={href}>
          <NavLink
            href={href}
            className={cn(
              "group relative flex items-center gap-2.5 rounded-md text-sm font-medium text-muted-foreground transition-colors outline-none",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              "focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
              isVertical ? "px-3 py-2" : "px-3 py-1.5",
            )}
          >
            {isVertical ? (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary opacity-0 transition-opacity group-data-[active=true]:opacity-100"
              />
            ) : null}
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}
