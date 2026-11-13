import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/auth";

const NAV = [
  { href: "/", label: "Chat" },
  { href: "/drafts", label: "Drafts" },
];

export function Shell({ active, children }: { active: "chat" | "drafts" | "admin"; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="flex items-baseline justify-between gap-6 px-gutter pt-8 pb-5">
        <Link href="/" className="font-serif text-lg tracking-wide text-headline">
          Fortitudo
        </Link>
        <nav className="flex items-baseline gap-6 text-sm">
          {NAV.map((item) => {
            const on = item.label.toLowerCase() === active;
            return (
              <Link key={item.href} href={item.href} aria-current={on ? "page" : undefined} className={on ? "text-text" : "text-muted hover:text-text"}>
                {item.label}
              </Link>
            );
          })}
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="text-muted hover:text-text">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <div className="mx-gutter h-px bg-gold/60" />
      {children}
    </div>
  );
}
