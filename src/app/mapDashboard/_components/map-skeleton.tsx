export function MapSkeleton() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-border border-t-primary" />
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Cargando mapa de flota…
      </p>
    </div>
  );
}
