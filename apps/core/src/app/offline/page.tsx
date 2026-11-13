export const dynamic = "force-static";

export default function Offline() {
  return (
    <main className="flex min-h-dvh flex-col justify-center gap-4 px-gutter">
      <p className="label">Offline</p>
      <h1 className="text-xl text-headline">No connection</h1>
      <p className="max-w-prose text-muted">Fortitudo needs the network for chat and drafts. It will pick up again when you are back online.</p>
    </main>
  );
}
