import { Brand } from "@/components/layout/brand";
import { PrimaryNav } from "@/components/navigation/primary-nav";
import { Separator } from "@/components/ui/separator";

/** Desktop application navigation. Hidden on narrow screens (see AppTopBar). */
export function AppSidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:flex lg:flex-col">
      <div className="flex h-14 items-center px-4">
        <Brand />
      </div>
      <Separator />
      <nav aria-label="Primary" className="flex-1 p-3">
        <PrimaryNav />
      </nav>
      <div className="p-4 text-[11px] leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground/70">Part 7 · Dialogue</p>
        <p>Translation, voices and dubbing arrive in later parts.</p>
      </div>
    </aside>
  );
}
