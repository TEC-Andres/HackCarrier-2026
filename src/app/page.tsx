import Link from "next/link";
import { BarChart3, Map, FlaskConical } from "lucide-react";

const modules = [
  {
    href: "/simulation",
    title: "Simulation",
    description: "Tank-level control model with live sensor polling and valve state.",
    icon: FlaskConical,
  },
  {
    href: "/clientVisualization",
    title: "Client Visualization",
    description: "Fleet and asset views for operators managing connected refrigeration units.",
    icon: BarChart3,
  },
  {
    href: "/mapDashboard",
    title: "Map Dashboard",
    description: "Geospatial asset tracking, geo-fences, and route-level operational alerts.",
    icon: Map,
  },
] as const;

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">
              LF
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-foreground">LYNX Fleet</p>
              <p className="text-[11px] text-muted-foreground">by Carrier · HackCarrier 2026</p>
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

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 md:py-16">
        <section className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">
            Connected cold chain
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Fleet intelligence for refrigerated operations
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Monitor connected refrigeration systems, surface fuel and equipment anomalies, and give
            operators at-a-glance visibility across the fleet — in one place.
          </p>
        </section>

        <section aria-label="Modules" className="mt-10 grid gap-4 md:grid-cols-3">
          {modules.map(({ href, title, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-lg border border-border bg-card p-5 shadow-sm transition-all hover:border-accent/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon aria-hidden="true" className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-foreground group-hover:text-primary">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              <span className="mt-4 inline-block text-sm font-medium text-accent">
                Open module →
              </span>
            </Link>
          ))}
        </section>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Carrier · LYNX Fleet reference UI</p>
          <p>HackCarrier 2026</p>
        </div>
      </footer>
    </div>
  );
}
