import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";

async function findUser(email: string | null | undefined) {
  if (!email) return null;
  const [row] = await db().select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return row ?? null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    // The users table is the allowlist. Anyone not in it is refused.
    async signIn({ user }) {
      return (await findUser(user.email)) !== null;
    },
  },
});

// The signed-in user, re-checked against the users table on every call so
// removing a row locks that login out at once. Null when not allowed.
export async function currentUser() {
  const session = await auth();
  return findUser(session?.user?.email);
}

// Use at the top of every protected page.
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

// Use for actions only the owner may take.
export async function requireOwner() {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  return user;
}
