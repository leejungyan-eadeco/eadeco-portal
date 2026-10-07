import { WarningCircle } from "@phosphor-icons/react/ssr";
import { btn } from "../ui";

export const metadata = { title: "Sign in · EADEPRO Portal" };

// Why the last sign-in attempt came back here (see src/app/auth/).
const errors: Record<string, string> = {
  "no-access": "Your EADECO account works, but you don't have access to the portal. Ask IT to add you.",
  account: "Your account has no Windows username the portal can use. Contact IT.",
  expired: "Signing in took too long. Try again.",
  unreachable: "The EADECO sign-in service isn't responding. Try again, or contact IT if it keeps happening.",
  failed: "Signing in didn't work. Try again, or contact IT if it keeps happening.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; removed?: string; error?: string; signedout?: string }> }) {
  const { next, removed, error, signedout } = await searchParams;
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden flex-col border-r border-line bg-sidebar px-12 py-12 lg:flex">
        <div className="my-auto">
          <img src="/logo-mark.png" alt="" className="mb-10 w-56 max-w-full" />
          {/* One line: the size follows the window (up to 36px) so it never needs to wrap. */}
          <h1 className="font-display text-[clamp(1.5rem,2.6vw,2.25rem)] font-semibold whitespace-nowrap text-ink">
            <span className="text-brand">EADEPRO</span> Business Portal
          </h1>
          <p className="mt-3 max-w-[48ch] text-ink-2">Recurring NAV invoices for every company EADEPRO handles, created as drafts for review.</p>
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
          {removed && <p className="mt-6 rounded-lg bg-warn-soft px-3.5 py-3 text-sm text-warn">You were signed out because your access to the portal was removed or changed. Ask IT if this is unexpected.</p>}
          {signedout && <p className="mt-6 rounded-lg bg-subtle px-3.5 py-3 text-sm text-ink-2">You're signed out.</p>}
          {error && (
            <p role="alert" className="mt-6 flex gap-2.5 rounded-lg bg-bad-soft px-3.5 py-3 text-sm text-bad">
              <WarningCircle size={18} weight="fill" className="mt-px shrink-0" />
              {errors[error] ?? errors.failed}
            </p>
          )}
          <a href={`/auth/login?next=${encodeURIComponent(next ?? "/")}`} className={`${btn.primary} mt-8 w-full py-2.5`}>
            Sign in with EADECO account
          </a>
          <p className="mt-5 text-center text-xs text-ink-3">The same sign-in as other EADECO apps. You stay signed in for the working day.</p>
        </div>
      </main>
    </div>
  );
}
