import { Brand } from "@/components/layout/brand";
import { PrimaryNav } from "@/components/navigation/primary-nav";

/** Compact navigation for narrow screens; the sidebar takes over from lg up. */
export function AppTopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur lg:hidden">
      <Brand />
      <nav aria-label="Primary" className="overflow-x-auto">
        <PrimaryNav orientation="horizontal" />
      </nav>
    </header>
  );
}
