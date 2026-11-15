import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/auth";
import { Shell } from "@/components/shell";
import { db } from "@/db";
import { contentItems, contentRevisions, projects } from "@/db/schema";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const when = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [row] = await db()
    .select({ item: contentItems, project: projects.name })
    .from(contentItems)
    .innerJoin(projects, eq(projects.id, contentItems.projectId))
    .where(eq(contentItems.id, id))
    .limit(1);
  if (!row) notFound();
  const { item } = row;

  const revisions = await db()
    .select({ id: contentRevisions.id, title: contentRevisions.title, author: contentRevisions.author, createdAt: contentRevisions.createdAt })
    .from(contentRevisions)
    .where(eq(contentRevisions.contentItemId, id))
    .orderBy(desc(contentRevisions.createdAt));

  return (
    <Shell active="drafts">
      <main className="grid gap-12 px-gutter py-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <article className="flex min-w-0 max-w-prose flex-col gap-6">
          <Link href="/drafts" className="label hover:text-text">
            ← Drafts
          </Link>
          <div className="flex flex-col gap-3">
            <p className="label">
              {row.project} · {item.type.replace("_", " ")} · {item.status}
            </p>
            <h1 className="text-display leading-tight text-headline">{item.title}</h1>
            {item.summary ? <p className="text-lg text-muted">{item.summary}</p> : null}
          </div>
          <div className="whitespace-pre-wrap font-serif text-lg leading-relaxed">{item.body || "(empty)"}</div>
        </article>
        <aside className="flex flex-col gap-4">
          <p className="label">Revisions</p>
          <ol className="flex flex-col gap-3 text-sm">
            {revisions.map((r) => (
              <li key={r.id} className="flex flex-col border-b border-line pb-3">
                <span className="text-text">{r.author === "agent" ? "Agent" : "You"}</span>
                <span className="text-muted">{when.format(r.createdAt)}</span>
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted">Publishing arrives in Phase 3, as a button only you can press.</p>
        </aside>
      </main>
    </Shell>
  );
}
