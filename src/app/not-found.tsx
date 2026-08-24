import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm space-y-4 text-center">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          404
        </p>
        <h1 className="text-lg font-semibold tracking-tight">
          This page does not exist
        </h1>
        <Button asChild variant="outline" size="sm">
          <Link href="/projects">Back to projects</Link>
        </Button>
      </div>
    </div>
  );
}
