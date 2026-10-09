"use client";

import { useState, useTransition } from "react";
import { CheckCircle, PencilSimple, PlugsConnected, XCircle } from "@phosphor-icons/react";
import type { NavServiceKey } from "@/lib/nav";
import { saveNavServer, saveNavServices, testNavConnection, testNavServiceName } from "../../actions";
import { ErrorNote } from "../../dialog";
import { btn, field, PageHeader, panel, td, th } from "../../ui";

type Service = { key: NavServiceKey; label: string; page: string; fallback: string; name: string };
type Check = { ok: boolean; text: string } | "testing";

function CheckResult({ check }: { check?: Check }) {
  if (!check) return <span className="text-ink-3">Not tested</span>;
  if (check === "testing") return <span className="text-ink-3">Testing</span>;
  return (
    <span className={`flex items-start gap-1.5 ${check.ok ? "text-good" : "text-bad"}`}>
      {check.ok ? <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0" /> : <XCircle size={16} weight="fill" className="mt-0.5 shrink-0" />}
      {check.text}
    </span>
  );
}

const authLabel = { current: "Windows account running the portal (Kerberos)", windows: "Domain account from .env", navuser: "NAV user password" };

// The server address, locked like the service names: a wrong one stops every company.
function ServerAddress({ value }: { value: string }) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(value);
  const [error, setError] = useState("");
  const [saving, start] = useTransition();
  const save = () =>
    start(async () => {
      setError("");
      const r = await saveNavServer(url);
      if (r.ok) setEditing(false);
      else setError(r.error);
    });
  return editing ? (
    <div className="mt-1 grid gap-2">
      {error && <ErrorNote>{error}</ErrorNote>}
      <input className={`${field} w-full`} value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} autoCapitalize="none" autoFocus />
      <div className="flex gap-2">
        <button className={`${btn.small} border-accent bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50`} disabled={saving || url.trim() === value} onClick={save}>
          {saving ? "Saving" : "Save"}
        </button>
        <button className={btn.small} onClick={() => (setUrl(value), setEditing(false), setError(""))}>
          Cancel
        </button>
      </div>
    </div>
  ) : (
    <dd className="mt-1 flex items-start justify-between gap-2 text-sm">
      <span className="break-all">{value || <span className="text-ink-3">Not set</span>}</span>
      <button className={`${btn.icon} -mt-1 shrink-0`} aria-label="Edit server address" title="Edit server address" onClick={() => setEditing(true)}>
        <PencilSimple size={16} />
      </button>
    </dd>
  );
}

export function NavSettingsView({ connection, services }: { connection: { baseUrl: string; auth: keyof typeof authLabel; account: string }; services: Service[] }) {
  const [names, setNames] = useState(Object.fromEntries(services.map((s) => [s.key, s.name])) as Record<NavServiceKey, string>);
  const [checks, setChecks] = useState<Partial<Record<NavServiceKey | "connection", Check>>>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  // Locked by default: a wrong name breaks invoice creation, so changing one is a deliberate step.
  const [editing, setEditing] = useState(false);
  const [saving, start] = useTransition();
  const dirty = services.some((s) => names[s.key] !== s.name);

  const run = async (key: NavServiceKey | "connection", fn: () => Promise<{ ok: true; data: string } | { ok: false; error: string }>) => {
    setChecks((c) => ({ ...c, [key]: "testing" }));
    const r = await fn();
    setChecks((c) => ({ ...c, [key]: r.ok ? { ok: true, text: r.data } : { ok: false, text: r.error } }));
  };
  const testAll = async () => {
    await run("connection", testNavConnection);
    await Promise.all(services.map((s) => run(s.key, () => testNavServiceName(names[s.key]))));
  };
  const save = () =>
    start(async () => {
      setError("");
      const r = await saveNavServices(names);
      if (r.ok) {
        setSaved(true);
        setEditing(false);
      }
      else setError(r.error);
    });

  return (
    <>
      <PageHeader
        title="NAV Connection"
        description="Which NAV 2018 web services the portal uses. Change a name here when IT republishes a service under a different name."
        actions={
          <button className={btn.secondary} onClick={testAll}>
            <PlugsConnected size={16} /> Test all
          </button>
        }
      />

      <section className={`${panel} mb-6`}>
        <dl className="grid grid-cols-1 divide-y divide-line md:grid-cols-[1fr_1fr_1.3fr] md:divide-x md:divide-y-0">
          <div className="px-5 py-4">
            <dt className="text-xs text-ink-3">Server</dt>
            <ServerAddress key={connection.baseUrl} value={connection.baseUrl} />
          </div>
          <div className="px-5 py-4">
            <dt className="text-xs text-ink-3">Signs in as</dt>
            <dd className="mt-1 text-sm">{authLabel[connection.auth] ?? connection.auth}</dd>
            {connection.auth !== "current" && <dd className="text-xs text-ink-3">{connection.account}</dd>}
          </div>
          <div className="px-5 py-4">
            <dt className="text-xs text-ink-3">Connection</dt>
            <dd className="mt-1 text-sm">
              <CheckResult check={checks.connection} />
            </dd>
          </div>
        </dl>
        <p className="border-t border-line px-5 py-3 text-xs text-ink-3">The server address is saved here. The sign-in (NAV_AUTH and the account) stays in the server's .env file, so no password is ever stored in the database.</p>
      </section>

      <section className={panel}>
        {error && (
          <div className="p-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-line bg-subtle">
              <tr>
                <th className={th}>Used for</th>
                <th className={th}>NAV page</th>
                <th className={`${th} w-[280px]`}>Web service name</th>
                <th className={th}>Check</th>
                <th className={th}>
                  <span className="sr-only">Test</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {services.map((s) => (
                <tr key={s.key}>
                  <td className={`${td} font-medium`}>{s.label}</td>
                  <td className={`${td} text-ink-2`}>{s.page}</td>
                  <td className="px-4 py-2">
                    <input
                      className={`${field} w-full read-only:border-line read-only:bg-subtle read-only:text-ink-2 read-only:focus:ring-0`}
                      value={names[s.key]}
                      readOnly={!editing}
                      aria-label={`Web service name for ${s.label}`}
                      onChange={(e) => {
                        setNames({ ...names, [s.key]: e.target.value });
                        setSaved(false);
                      }}
                    />
                    {names[s.key] !== s.fallback && <span className="mt-1 block text-xs text-ink-3">Standard name: {s.fallback}</span>}
                  </td>
                  <td className={`${td} max-w-[40ch]`}>
                    <CheckResult check={checks[s.key]} />
                  </td>
                  <td className={`${td} py-2 text-right`}>
                    <button className={btn.small} onClick={() => run(s.key, () => testNavServiceName(names[s.key]))}>
                      Test
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 border-t border-line px-5 py-4">
          {editing ? (
            <>
              <button className={`${btn.primary} disabled:pointer-events-none disabled:opacity-50`} disabled={!dirty || saving} onClick={save}>
                {saving ? "Saving" : "Save names"}
              </button>
              <button
                className={btn.secondary}
                onClick={() => {
                  setNames(Object.fromEntries(services.map((s) => [s.key, s.name])) as Record<NavServiceKey, string>);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <span className="text-xs text-ink-3">Test a name before saving. A wrong name stops invoices being created for every company.</span>
            </>
          ) : (
            <>
              <button className={btn.secondary} onClick={() => (setEditing(true), setSaved(false))}>
                <PencilSimple size={16} /> Edit names
              </button>
              {saved && <span className="text-sm text-good">Saved. The portal now uses these names.</span>}
            </>
          )}
        </div>
      </section>
    </>
  );
}
