import Link from "next/link";
import { requireTenant } from "@/server/session";
import { logout } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireTenant();
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold">{user.companyName}</span>
          <nav className="flex gap-4 text-sm text-stone-600">
            <Link href="/" className="hover:text-stone-900">Quotes</Link>
            <Link href="/rates" className="hover:text-stone-900">Rates</Link>
            <Link href="/customers" className="hover:text-stone-900">Customers</Link>
            <Link href="/settings" className="hover:text-stone-900">Settings</Link>
          </nav>
          <form action={logout} className="ml-auto flex items-center gap-3 text-sm text-stone-500">
            <span>{user.name}</span>
            <button className="underline hover:text-stone-900">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
