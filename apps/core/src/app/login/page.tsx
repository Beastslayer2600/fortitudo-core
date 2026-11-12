import { signIn } from "@/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-dvh flex-col justify-center gap-10 px-gutter">
      <div className="flex flex-col gap-4">
        <p className="label">Fortitudo</p>
        <h1 className="text-display leading-tight text-headline">Strength to build it, patience to keep it.</h1>
        <div className="h-px w-16 bg-gold" />
      </div>
      {error ? <p className="text-sm text-muted">That account is not allowed in.</p> : null}
      <form
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/" });
        }}
      >
        <button type="submit" className="min-h-11 rounded-sm border border-line px-6 text-sm text-text transition-colors hover:border-muted">
          Sign in with GitHub
        </button>
      </form>
    </main>
  );
}
