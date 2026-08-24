import { cn } from "@/lib/utils";

/**
 * Marks a region as intentionally non-functional so placeholder UI is never
 * mistaken for a feature that already works.
 */
export function PlaceholderBadge({
  children = "Not implemented",
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
