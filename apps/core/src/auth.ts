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

// Use at the top of every protected page or route. Checks the session and
// re-checks the users table, so removing a row locks that login out at once.
export async function requireUser() {
  const session = await auth();
  const user = await findUser(session?.user?.email);
  if (!user) redirect("/login");
  return user;
}
