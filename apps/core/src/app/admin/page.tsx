import { requireUser, signOut } from "@/auth";
import { db } from "@/db";
import { allTables } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireUser();
  const rows = await Promise.all(
    Object.entries(allTables).map(async ([name, table]) => ({
      name,
      count: await db().$count(table),
    })),
  );

  return (
    <main className="mx-auto max-w-xl px-8 py-16">
      <h1 className="text-2xl">Fortitudo Core</h1>
      <p className="mt-2 text-sm opacity-70">
        Signed in as {user.email} ({user.role})
      </p>
      <table className="mt-10 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-current/30">
            <th className="py-2 font-normal opacity-70">Table</th>
            <th className="py-2 text-right font-normal opacity-70">Rows</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-current/10">
              <td className="py-2 font-mono">{row.name}</td>
              <td className="py-2 text-right tabular-nums">{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="mt-10"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button type="submit" className="text-sm underline opacity-70">
          Sign out
        </button>
      </form>
    </main>
  );
}
