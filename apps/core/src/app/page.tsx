import { requireOwner } from "@/auth";
import { Chat } from "@/components/chat";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  await requireOwner();
  return (
    <Shell active="chat">
      <Chat />
    </Shell>
  );
}
