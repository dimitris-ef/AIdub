import Link from "next/link";
import { AudioLines } from "lucide-react";

import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <Link
      href="/projects"
      className={cn(
        "flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/25"
      >
        <AudioLines className="size-4" />
      </span>
      <span className="text-sm font-semibold tracking-tight">Aidub</span>
    </Link>
  );
}
