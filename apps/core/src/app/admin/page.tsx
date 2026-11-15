import { requireUser } from "@/auth";
import { Shell } from "@/components/shell";
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
    <Shell active="admin">
      <main className="flex max-w-xl flex-col gap-8 px-gutter py-10">
        <div className="flex flex-col gap-2">
          <p className="label">Admin</p>
          <h1 className="text-xl text-headline">Fortitudo Core</h1>
          <p className="text-sm text-muted">
            Signed in as {user.email} ({user.role})
          </p>
        </div>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="py-2 font-normal text-muted">Table</th>
              <th className="py-2 text-right font-normal text-muted">Rows</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-b border-line">
                <td className="py-2 font-mono">{row.name}</td>
                <td className="py-2 text-right tabular-nums">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </Shell>
  );
}
