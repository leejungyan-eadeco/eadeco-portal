"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowsClockwise, CheckCircle, Plus, Trash, WarningCircle } from "@phosphor-icons/react";
import type { Company, NavLookups, Option, ParkingColumns, ParkingLine, ParkingSample, ParkingSetup } from "@/lib/types";
import { getLookups } from "../../actions";
import { Dialog, ErrorNote } from "../../dialog";
import { getParkingSample, saveParkingSetup, testParkingSignIn } from "../../parking-actions";
import { SearchSelect, TagSelect } from "../../select";
import { btn, Field, field, fmtDate, num, rm, td, th } from "../../ui";

const toOpt = (o: Option) => ({ value: o.no, label: `${o.no}, ${o.name}` });
const blankLine = (): ParkingLine => ({ label: "", values: [], glAccount: "", description: "", dim1: "", dim2: "" });

const columnFields = [
  ["net", "Net sales", "Becomes each NAV line's unit price."],
  ["sst", "SST", "Shown beside each run, to check against the SST NAV works out."],
  ["type", "Payment type", "Decides which NAV line a row's money goes to."],
] as const;

export function SetupForm({ edit, companies, onClose, onSaved }: { edit: ParkingSetup; companies: Company[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [s, setS] = useState(() => ({ ...edit }));
  const [password, setPassword] = useState("");
  const [nav, setNav] = useState<NavLookups | null>(null);
  const [navError, setNavError] = useState("");
  const [sample, setSample] = useState<(ParkingSample & { columns: ParkingColumns }) | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState("");
  const [saving, start] = useTransition();

  const set = (change: Partial<typeof s>) => setS((x) => ({ ...x, ...change }));
  const setLine = (i: number, change: Partial<ParkingLine>) => set({ lines: s.lines.map((l, j) => (j === i ? { ...l, ...change } : l)) });

  // NAV lists belong to a company: load them whenever the company changes.
  useEffect(() => {
    setNav(null);
    setNavError("");
    if (s.companyCode) getLookups(s.companyCode).then((r) => (r.ok ? setNav(r.data) : setNavError(r.error)));
  }, [s.companyCode]);

  // An existing setup previews from the rows it already kept (its latest day); re-read when the columns change.
  const columnsKey = JSON.stringify([s.columns, s.countOnly]);
  useEffect(() => {
    getParkingSample(edit.id, s.columns, s.countOnly).then((r) => r.ok && r.data && setSample({ ...r.data, columns: s.columns }));
  }, [columnsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    const r = await testParkingSignIn({ id: edit.id, portalUrl: s.portalUrl, username: s.username, password });
    setTesting(false);
    setTestResult(r.ok ? { ok: true, text: r.data } : { ok: false, text: r.error });
  };

  // Preview: the sample day's money per NAV line, and payment types with money that no line takes yet.
  const sampleFits = sample && JSON.stringify(sample.columns) === JSON.stringify(s.columns);
  const types = sampleFits ? sample.types : [];
  const lineOf = (value: string) => s.lines.findIndex((l) => l.values.some((v) => v.trim().toLowerCase() === value.trim().toLowerCase()));
  const unassigned = types.filter((t) => lineOf(t.value) < 0 && (t.net || t.sst));
  const preview = s.lines.map((l, i) => types.filter((t) => lineOf(t.value) === i).reduce((a, t) => ({ count: a.count + t.count, net: a.net + t.net, sst: a.sst + t.sst }), { count: 0, net: 0, sst: 0 }));

  const dims = nav ? ([["dim1", nav.dim1], ["dim2", nav.dim2]] as const).filter(([, d]) => d) : [];
  const gl = nav?.lines["G/L Account"] ?? [];
  const headers = [...new Set([...(sample?.headers ?? []), s.columns.net, s.columns.sst, s.columns.type].filter(Boolean))];

  const save = () =>
    start(async () => {
      setError("");
      const r = await saveParkingSetup({ ...s, id: edit.id, password: password || undefined });
      if (!r.ok) return setError(r.error);
      onSaved(r.data.warning ?? `"${s.name}" saved. The next run uses these settings.`);
    });

  return (
    <Dialog
      open
      wide
      variant="sheet"
      onClose={onClose}
      title={`Configuration: ${edit.name}`}
      footer={
        <>
          <button className={`${btn.primary} disabled:pointer-events-none disabled:opacity-50`} disabled={saving} onClick={save}>
            {saving ? "Saving" : "Save changes"}
          </button>
          <button className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
          <span className="self-center text-xs text-ink-3">Every change is recorded in the setup&apos;s history with your name.</span>
        </>
      }
    >
      <form className="grid grid-cols-[minmax(0,1fr)] gap-8" onSubmit={(e) => (e.preventDefault(), save())}>
        {error && <ErrorNote>{error}</ErrorNote>}

        <section className="grid gap-4">
          <h3 className="text-sm font-semibold">General</h3>
          <div className="flex flex-col gap-4 sm:flex-row [&>*]:min-w-0 [&>*]:flex-1">
            <Field label="Name" required hint="e.g. the carpark: PALO 101 Ipoh">
              <input className={field} value={s.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="First report date" required hint="No day before this is ever fetched.">
              <input type="date" className={field} value={s.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            </Field>
          </div>
        </section>

        <section className="grid gap-4 border-t border-line pt-6">
          <h3 className="text-sm font-semibold">Parking portal</h3>
          <Field label="URL" required hint="The address you open to sign in, without /login. The report is read from its /report page.">
            <input className={field} value={s.portalUrl} placeholder="http://palo101.park.whizcity.my:8081" spellCheck={false} onChange={(e) => set({ portalUrl: e.target.value })} />
          </Field>
          <div className="flex flex-col gap-4 sm:flex-row [&>*]:min-w-0 [&>*]:flex-1">
            <Field label="Username" required>
              <input className={field} value={s.username} autoComplete="off" spellCheck={false} onChange={(e) => set({ username: e.target.value })} />
            </Field>
            <Field label="Password" required hint={edit.hasPassword ? "A password is saved. Type here only to replace it." : "Stored encrypted. Nobody can read it back, including admins."}>
              <input type="password" className={field} value={password} autoComplete="new-password" placeholder={edit.hasPassword ? "••••••••  (saved)" : ""} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={`${btn.secondary} disabled:pointer-events-none disabled:opacity-50`} disabled={testing} onClick={test}>
              <ArrowsClockwise size={16} className={testing ? "animate-spin" : ""} /> {testing ? "Signing in" : "Test sign-in"}
            </button>
            <span className="text-xs text-ink-3">Signs in to the parking portal with this URL, username and password. Nothing is downloaded.</span>
          </div>
          {testResult && (
            <p className={`flex gap-2 rounded-lg px-3.5 py-3 text-sm ${testResult.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>
              {testResult.ok ? <CheckCircle size={18} weight="fill" className="mt-px shrink-0" /> : <WarningCircle size={18} weight="fill" className="mt-px shrink-0" />}
              {testResult.text}
            </p>
          )}
        </section>

        <section className="grid gap-4 border-t border-line pt-6">
          <h3 className="text-sm font-semibold">NAV invoice</h3>
          <div className="flex flex-col gap-4 sm:flex-row [&>*]:min-w-0 [&>*]:flex-1">
            <Field as="div" label="Company" required>
              <SearchSelect
                label="Company"
                placeholder="Select a company"
                value={s.companyCode ?? ""}
                onChange={(v) => set({ companyCode: v, customerNo: "", lines: s.lines.map((l) => ({ ...l, glAccount: "", dim1: "", dim2: "" })) })}
                options={companies.filter((c) => c.active || c.code === edit.companyCode).map((c) => ({ value: c.code, label: c.name }))}
              />
            </Field>
            <Field as="div" label="Customer" required hint={!s.companyCode ? "Choose a company first" : nav ? `${nav.customers.length} customers in NAV` : navError ? "NAV list unavailable" : "Loading from NAV"}>
              <SearchSelect label="Customer" placeholder="Search customers by number or name" value={s.customerNo} disabled={!nav} onChange={(v) => set({ customerNo: v })} options={(nav?.customers ?? []).map(toOpt)} />
            </Field>
          </div>
          {navError && <ErrorNote>Could not read NAV lists: {navError}</ErrorNote>}
        </section>

        <section className="grid gap-4 border-t border-line pt-6">
          <div>
            <h3 className="text-sm font-semibold">Excel columns</h3>
            <p className="mt-0.5 text-sm text-ink-2">Columns are found by their header text, so it doesn&apos;t matter if the parking portal moves them. If a header disappears, the run stops instead of reading the wrong numbers.</p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row [&>*]:min-w-0 [&>*]:flex-1">
            <Field label="Header row" required hint="The row with the column names. Rows below it are transactions.">
              <input type="number" min={1} max={100} className={field} value={s.headerRow} onChange={(e) => set({ headerRow: Math.trunc(Number(e.target.value) || 0) })} />
            </Field>
            {columnFields.map(([k, label, hint]) => (
              <Field key={k} as="div" label={label} required hint={hint}>
                <SearchSelect label={label} value={s.columns[k]} options={headers.map((h) => ({ value: h, label: h }))} onChange={(v) => set({ columns: { ...s.columns, [k]: v } })} />
              </Field>
            ))}
          </div>
        </section>

        <section className="grid gap-4 border-t border-line pt-6">
          <div>
            <h3 className="text-sm font-semibold">Rows that count</h3>
            <p className="mt-0.5 text-sm text-ink-2">The report also lists tickets that were never paid. Only rows matching this rule reach the invoice; leave the column empty to count every row.</p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row [&>*]:min-w-0 [&>*]:flex-1">
            <Field as="div" label="Column">
              <SearchSelect
                clearable
                label="Count only rows where"
                placeholder="Every row counts"
                value={s.countOnly?.column ?? ""}
                options={[...new Set([...headers, s.countOnly?.column ?? ""])].filter(Boolean).map((h) => ({ value: h, label: h }))}
                onChange={(v) => set({ countOnly: v ? { column: v, values: s.countOnly?.values ?? [] } : null })}
              />
            </Field>
            <Field as="div" label="Is one of" hint='e.g. "pay succeed"'>
              <TagSelect label="Values that count" disabled={!s.countOnly} value={s.countOnly?.values ?? []} options={[]} onChange={(v) => s.countOnly && set({ countOnly: { ...s.countOnly, values: v } })} />
            </Field>
          </div>
        </section>

        <section className="grid gap-4 border-t border-line pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">NAV lines</h3>
              <p className="mt-0.5 max-w-[80ch] text-sm text-ink-2">
                Each line is the day&apos;s net sales of its payment types. Several types can share a line. A payment type with money that no line takes stops the run, so nothing goes missing.
              </p>
            </div>
            <button type="button" className={btn.secondary} onClick={() => set({ lines: [...s.lines, blankLine()] })}>
              <Plus size={16} /> Add line
            </button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[1250px] text-sm">
              <thead className="bg-subtle">
                <tr>
                  <th className={`${th} w-[150px]`}>Name *</th>
                  <th className={`${th} w-[300px]`}>Payment types *</th>
                  <th className={`${th} w-[220px]`}>G/L account *</th>
                  <th className={`${th} w-[190px]`}>Description</th>
                  {dims.map(([k, d]) => (
                    <th key={k} className={`${th} w-[160px]`}>
                      {d!.label}
                    </th>
                  ))}
                  <th className={th}>
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.lines.map((l, i) => (
                  <tr key={i} className="align-top">
                    <td className="px-2 py-2">
                      <input className={`${field} w-full`} value={l.label} placeholder="e.g. TNG" onChange={(e) => setLine(i, { label: e.target.value })} aria-label="Line name" />
                    </td>
                    <td className="px-2 py-2">
                      <TagSelect label="Payment types" value={l.values} options={types.map((t) => t.value)} onChange={(v) => setLine(i, { values: v })} />
                    </td>
                    <td className="px-2 py-2">
                      <SearchSelect compact label="G/L account" placeholder={nav ? "Search" : "Company first"} disabled={!nav} value={l.glAccount} options={gl.map(toOpt)} onChange={(v) => setLine(i, { glAccount: v })} />
                    </td>
                    <td className="px-2 py-2">
                      <input className={`${field} w-full`} maxLength={50} placeholder={`${l.label || "Name"} parking <date>`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label="Description" />
                    </td>
                    {dims.map(([k, d]) => (
                      <td key={k} className="px-2 py-2">
                        <SearchSelect compact clearable label={d!.label} placeholder="" value={l[k]} options={d!.values.map(toOpt)} onChange={(v) => setLine(i, { [k]: v })} />
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right">
                      <button type="button" className={btn.icon} aria-label={`Remove line ${l.label}`} onClick={() => set({ lines: s.lines.filter((_, j) => j !== i) })}>
                        <Trash size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 rounded-lg border border-line p-4">
            <div>
              <h4 className="text-sm font-medium">SST line</h4>
              <p className="mt-0.5 text-sm text-ink-2">
                Adds the day&apos;s SST from the report as its own line, the way finance does it by hand, so the invoice total equals the report&apos;s. Leave the G/L account empty to leave SST to NAV&apos;s VAT setup instead.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row [&>*]:min-w-0 [&>*]:flex-1">
              <Field as="div" label="G/L account" hint="e.g. 211-600000 SST payable">
                <SearchSelect clearable label="SST G/L account" placeholder={nav ? "No SST line" : "Company first"} disabled={!nav} value={s.sstLine?.glAccount ?? ""} options={gl.map(toOpt)} onChange={(v) => set({ sstLine: v ? { glAccount: v, description: s.sstLine?.description ?? "SST", dim1: s.sstLine?.dim1 ?? "", dim2: s.sstLine?.dim2 ?? "" } : null })} />
              </Field>
              <Field label="Description">
                <input className={field} maxLength={50} disabled={!s.sstLine} placeholder="SST parking <date>" value={s.sstLine?.description ?? ""} onChange={(e) => s.sstLine && set({ sstLine: { ...s.sstLine, description: e.target.value } })} />
              </Field>
              {dims.map(([k, d]) => (
                <Field key={k} as="div" label={d!.label}>
                  <SearchSelect clearable label={`SST ${d!.label}`} placeholder="" disabled={!s.sstLine} value={s.sstLine?.[k] ?? ""} options={d!.values.map(toOpt)} onChange={(v) => s.sstLine && set({ sstLine: { ...s.sstLine, [k]: v } })} />
                </Field>
              ))}
            </div>
          </div>
          {sampleFits && (
            <p className="text-xs text-ink-3">
              Preview from the last report kept ({fmtDate(sample.date)}): lines RM {rm(preview.reduce((a, p) => a + p.net, 0))}
              {s.sstLine ? ` + SST line RM ${rm(preview.reduce((a, p) => a + p.sst, 0))} = RM ${rm(preview.reduce((a, p) => a + p.net + p.sst, 0))} on the invoice` : `, report SST RM ${rm(preview.reduce((a, p) => a + p.sst, 0))} (left to NAV's VAT)`}.
            </p>
          )}
          {unassigned.length > 0 && (
            <div className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
              <p className="font-medium">Not on any line yet, so a run would stop:</p>
              <ul className="mt-1 list-disc pl-5">
                {unassigned.map((t) => (
                  <li key={t.value}>
                    {t.value || "(blank)"}: {t.count} rows, RM {rm(t.net + t.sst)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {sampleFits && types.length > 0 && (
            <details className="text-sm text-ink-2">
              <summary className="cursor-pointer text-xs font-medium text-ink-3">Every payment type in {fmtDate(sample.date)}&apos;s report</summary>
              <table className="mt-2 w-full max-w-xl">
                <thead>
                  <tr>
                    <th className={th}>Payment type</th>
                    <th className={`${th} text-right`}>Rows</th>
                    <th className={`${th} text-right`}>Net (RM)</th>
                    <th className={`${th} text-right`}>SST (RM)</th>
                    <th className={th}>Line</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {types.map((t) => (
                    <tr key={t.value}>
                      <td className={td}>{t.value || <span className="text-ink-3">(blank)</span>}</td>
                      <td className={`${td} ${num}`}>{t.count}</td>
                      <td className={`${td} ${num}`}>{rm(t.net)}</td>
                      <td className={`${td} ${num}`}>{rm(t.sst)}</td>
                      <td className={td}>{lineOf(t.value) >= 0 ? s.lines[lineOf(t.value)].label : t.net || t.sst ? <span className="text-warn">None</span> : <span className="text-ink-3">No money</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </section>
      </form>
    </Dialog>
  );
}
