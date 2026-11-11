import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-8">
      <h1 className="text-2xl">Fortitudo Core</h1>
      {error ? <p className="text-sm opacity-70">That account is not allowed in.</p> : null}
      <form
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/admin" });
        }}
      >
        <button type="submit" className="w-full rounded border border-current px-4 py-3 text-sm">
          Sign in with GitHub
        </button>
      </form>
    </main>
  );
}
