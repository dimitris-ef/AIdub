import type { ReactNode } from "react";

/** Shared framing for the Transcript workspace's non-content states. */
export function TranscriptMessage({
  icon,
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border bg-card/30 p-8 text-center">
      <span
        aria-hidden
        className="grid size-10 place-items-center rounded-md bg-muted text-muted-foreground"
      >
        {icon}
      </span>
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
