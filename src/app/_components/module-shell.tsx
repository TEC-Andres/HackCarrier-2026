import type { ReactNode } from "react";
import Link from "next/link";

export function ModuleShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex h-8 w-8 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Back to home"
            >
              LF
            </Link>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-foreground">LYNX Fleet</p>
              <p className="text-[11px] text-muted-foreground">{title}</p>
            </div>
          </div>
          <nav aria-label="Primary" className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
            <Link href="/simulation" className="transition-colors hover:text-foreground">
              Simulation
            </Link>
            <Link href="/clientVisualization" className="transition-colors hover:text-foreground">
              Clients
            </Link>
            <Link href="/mapDashboard" className="transition-colors hover:text-foreground">
              Map
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10">{children}</main>
    </div>
  );
}
