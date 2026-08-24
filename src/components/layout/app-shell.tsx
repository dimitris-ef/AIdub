import type { ReactNode } from "react";

import { AppSidebar } from "@/components/navigation/app-sidebar";
import { AppTopBar } from "@/components/navigation/app-top-bar";

/**
 * The single application shell. Every route renders inside it, so navigation
 * and chrome are never re-implemented per route.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      <AppTopBar />
      <AppSidebar />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
