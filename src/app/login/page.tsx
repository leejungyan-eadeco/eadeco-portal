import { LoginForm } from "./form";

export const metadata = { title: "Sign in · EADEPRO Portal" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; removed?: string }> }) {
  const { next, removed } = await searchParams;
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden flex-col border-r border-line bg-sidebar px-12 py-12 lg:flex">
        <div className="my-auto max-w-[40ch]">
          <img src="/logo-mark.png" alt="" className="mb-10 w-56 max-w-full" />
          <h1 className="font-display text-4xl font-semibold text-ink"><span className="text-brand">EADEPRO</span> Business Portal</h1>
          <p className="mt-3 text-ink-2">Recurring NAV invoices for every company EADEPRO handles, created as drafts for review.</p>
        </div>
        <p className="text-xs text-ink-3">A member of Eastern Decorator Group</p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src="/logo-mark.png" alt="" className="h-8 w-auto" />
            <span className="flex flex-col leading-none">
              <span className="font-display text-[18px] font-bold tracking-wide text-brand">EADEPRO</span>
              <span className="mt-1 text-[11px] font-medium text-accent-ink">Business Portal</span>
            </span>
          </div>
          <h2 className="font-display text-[28px] font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-ink-2">Use your Windows (EADECO) account.</p>
          {removed && <p className="mt-6 rounded-lg bg-warn-soft px-3.5 py-3 text-sm text-warn">You were signed out because your access to the portal was removed or changed. Ask an admin if this is unexpected.</p>}
          <LoginForm next={next ?? "/"} />
        </div>
      </main>
    </div>
  );
}
