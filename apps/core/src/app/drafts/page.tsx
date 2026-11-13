import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { requireOwner } from "@/auth";
import { Shell } from "@/components/shell";
import { db } from "@/db";
import { contentItems, projects } from "@/db/schema";

export const dynamic = "force-dynamic";

const TYPE_LABEL = { guide: "Guide", insight: "Insight", page_copy: "Page copy" } as const;
const when = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });

export default async function DraftsPage() {
  await requireOwner();
  const drafts = await db()
    .select({
      id: contentItems.id,
      title: contentItems.title,
      type: contentItems.type,
      project: projects.name,
      updatedAt: contentItems.updatedAt,
    })
    .from(contentItems)
    .innerJoin(projects, eq(projects.id, contentItems.projectId))
    .where(eq(contentItems.status, "draft"))
    .orderBy(desc(contentItems.updatedAt));

  return (
    <Shell active="drafts">
      <main className="flex flex-col gap-8 px-gutter py-10">
        <div className="flex flex-col gap-2">
          <p className="label">Drafts</p>
          <h1 className="text-xl text-headline">Waiting for you</h1>
        </div>
        {drafts.length === 0 ? (
          <p className="max-w-prose text-muted">No drafts yet. Ask the agent for one from Chat.</p>
        ) : (
          <ul className="flex max-w-3xl flex-col">
            {drafts.map((d) => (
              <li key={d.id} className="border-b border-line">
                <Link href={`/drafts/${d.id}`} className="flex flex-col gap-1 py-5 transition-colors hover:text-headline">
                  <span className="font-serif text-lg">{d.title}</span>
                  <span className="text-sm text-muted">
                    {TYPE_LABEL[d.type]} · {d.project} · {when.format(d.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </Shell>
  );
}
