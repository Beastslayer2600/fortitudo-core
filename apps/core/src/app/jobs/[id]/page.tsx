import { notFound } from "next/navigation";
import { requireOwner } from "@/auth";
import { Shell } from "@/components/shell";
import { db } from "@/db";
import { jobView } from "@/worker/service";
import { SubNav } from "../parts";
import { LiveJob } from "./live";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  const first = await jobView(db(), id, 0);
  if (!first) notFound();
  return (
    <Shell active="jobs">
      <main className="flex flex-col gap-8 px-gutter py-10">
        <SubNav active="jobs" />
        <LiveJob id={id} first={first} />
      </main>
    </Shell>
  );
}
