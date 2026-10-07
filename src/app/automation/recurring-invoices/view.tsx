"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { CheckCircle, Info, Lightning, Pause, PencilSimple, Play, Plus, Trash } from "@phosphor-icons/react";
import {
  blankLine,
  frequencies,
  invoiceTotal,
  lineAmount,
  lineTypeLabel,
  lineTypes,
  scheduleText,
  weekdays,
  type Company,
  type Frequency,
  type InvoiceType,
  type Line,
  type NavLookups,
  type Option,
  type RecurringInvoice,
} from "@/lib/types";
import { deleteInvoice, findDuplicateInvoice, getLookups, runInvoiceNow, saveInvoice, setInvoiceStatus } from "../../actions";
import { columnHelper, DataTable, RowActions, type Columns } from "../../data-table";
import { Confirm, Dialog, ErrorNote } from "../../dialog";
import { SearchSelect } from "../../select";
import { btn, Field, field, fmtDate, num, PageHeader, panel, relativeDay, rm, StatusBadge, td, th } from "../../ui";

// Compact input for the NAV-style lines grid.
const cell =
  "w-full min-w-0 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-3";

// "No items in NAV" when a company has none of a line type.
const noun = { "G/L Account": "G/L accounts", Item: "items", Resource: "resources", "Fixed Asset": "fixed assets", "Charge (Item)": "item charges" };

const toOpt = (o: Option) => ({ value: o.no, label: `${o.no}, ${o.name}` });

function scheduleSentence(type: InvoiceType, f: Frequency, weekday: number, monthDay: number, start: string, end: string) {
  const day = monthDay === 0 ? "the last day" : `day ${monthDay}`;
  const when = {
    Daily: "every day",
    Weekly: `every ${weekdays[weekday]}`,
    Monthly: `on ${day} of every month`,
    Quarterly: `on ${day} of every third month`,
    Yearly: `once a year, on ${day} of ${start ? fmtDate(start).split(" ")[1] : "the start month"}`,
  }[f];
  return `Creates a draft ${type.toLowerCase()} invoice in NAV ${when}${start ? `, starting ${fmtDate(start)}` : ""}${end ? `, until ${fmtDate(end)}` : ""}.`;
}

function InvoiceForm({ invoice, companies, onClose }: { invoice: RecurringInvoice | "new"; companies: Company[]; onClose: () => void }) {
  const edit = invoice === "new" ? null : invoice;
  const [company, setCompany] = useState(edit?.company ?? "");
  const [type, setType] = useState<InvoiceType>(edit?.type ?? "Sales");
  const [partyNo, setPartyNo] = useState(edit?.partyNo ?? "");
  const [yourReference, setYourReference] = useState(edit?.yourReference ?? "");
  const [frequency, setFrequency] = useState<Frequency>(edit?.frequency ?? "Monthly");
  const [weekday, setWeekday] = useState(edit?.weekday ?? 0);
  const [monthDay, setMonthDay] = useState(edit?.monthDay ?? 1);
  const [startDate, setStartDate] = useState(edit?.startDate ?? "");
  const [endDate, setEndDate] = useState(edit?.endDate ?? "");
  const [lines, setLines] = useState<Line[]>(edit?.lines ?? [blankLine()]);
  const [nav, setNav] = useState<NavLookups | null>(null);
  const [navError, setNavError] = useState("");
  const [error, setError] = useState("");
  const [saving, start] = useTransition();

  // NAV lists belong to a company: load them whenever the company changes.
  useEffect(() => {
    setNav(null);
    setNavError("");
    if (company) getLookups(company).then((r) => (r.ok ? setNav(r.data) : setNavError(r.error)));
  }, [company]);

  const partyLabel = type === "Sales" ? "Customer" : "Vendor";
  const parties = nav ? (type === "Sales" ? nav.customers : nav.vendors) : [];
  const dims = nav ? ([["dim1", nav.dim1], ["dim2", nav.dim2]] as const).filter(([, d]) => d) : [];
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const changeCompany = (c: string) => {
    setCompany(c);
    setPartyNo("");
    setLines(lines.map((l) => ({ ...l, no: "", locationCode: "", unitOfMeasure: "", dim1: "", dim2: "" })));
  };

  const [twin, setTwin] = useState<{ partyName: string; schedule: string; total: number } | null>(null);
  const input = () => ({ id: edit?.id, company, type, partyNo, yourReference, frequency, weekday, monthDay, startDate, endDate: endDate || null, lines });
  // Warn first if an identical recurring invoice already exists; saving anyway is the person's call.
  const save = () =>
    start(async () => {
      setError("");
      const d = await findDuplicateInvoice(input());
      if (d.ok && d.data) return setTwin(d.data);
      const r = await saveInvoice(input());
      if (r.ok) onClose();
      else setError(r.error);
    });

  // Same rules the server checks on save, spelled out so people know exactly what is left.
  const missing = [
    !company && "a company",
    !partyNo && `a ${partyLabel.toLowerCase()}`,
    !startDate && "a start date",
    !lines.some((l) => l.type !== "") && "a line that is not a text line",
    ...lines.map((l, i) => (l.type === "" ? !l.description.trim() && `text for line ${i + 1}` : !l.no && `a No. on line ${i + 1}`)),
  ].filter(Boolean);
  const ready = nav && missing.length === 0;

  return (
    <Dialog
      open
      wide
      variant="sheet"
      onClose={onClose}
      title={edit ? "Edit recurring invoice" : "New recurring invoice"}
      footer={
        <>
          <button className={`${btn.primary} disabled:pointer-events-none disabled:opacity-50`} disabled={!ready || saving} onClick={save}>
            {saving ? "Saving" : edit ? "Save changes" : "Create"}
          </button>
          <button className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
          {missing.length > 0 && <span className="self-center text-xs text-ink-3">Still needed: {missing.join(", ")}.</span>}
        </>
      }
    >
      <form className="grid grid-cols-[minmax(0,1fr)] gap-8" onSubmit={(e) => (e.preventDefault(), save())}>
        {error && <ErrorNote>{error}</ErrorNote>}

        <section className="grid gap-4">
          <h3 className="text-sm font-semibold">General</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field as="div" label="Company" required hint="Companies are set up by IT in Settings">
              <SearchSelect
                label="Company"
                placeholder="Select a company"
                value={company}
                onChange={changeCompany}
                options={companies.filter((c) => c.active || c.code === edit?.company).map((c) => ({ value: c.code, label: c.name }))}
              />
            </Field>
            <Field as="div" label="Invoice type" required>
              <SearchSelect
                label="Invoice type"
                value={type}
                onChange={(v) => {
                  setType(v as InvoiceType);
                  setPartyNo("");
                }}
                options={[
                  { value: "Sales", label: "Sales" },
                  { value: "Purchase", label: "Purchase" },
                ]}
              />
            </Field>
            <Field
              as="div"
              label={`${partyLabel} No.`}
              required
              hint={!company ? "Choose a company first" : nav ? `${parties.length} ${partyLabel.toLowerCase()}s in NAV` : navError ? "NAV list unavailable" : "Loading from NAV"}
            >
              <SearchSelect
                label={`${partyLabel} No.`}
                placeholder={`Search ${partyLabel.toLowerCase()}s by number or name`}
                value={partyNo}
                disabled={!nav}
                onChange={setPartyNo}
                options={parties.map(toOpt)}
              />
            </Field>
            <Field label="Your Reference" hint="Copied onto every invoice. NAV allows 35 characters.">
              <input className={field} value={yourReference} maxLength={35} onChange={(e) => setYourReference(e.target.value)} />
            </Field>
          </div>
          {navError && <ErrorNote>Could not read NAV lists: {navError}</ErrorNote>}
        </section>

        <section className="grid gap-4 border-t border-line pt-6">
          <h3 className="text-sm font-semibold">Schedule</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field as="div" label="Frequency" required>
              <SearchSelect label="Frequency" value={frequency} onChange={(v) => setFrequency(v as Frequency)} options={frequencies.map((f) => ({ value: f, label: f }))} />
            </Field>
            {frequency === "Weekly" && (
              <Field as="div" label="On">
                <SearchSelect label="Day of the week" value={String(weekday)} onChange={(v) => setWeekday(Number(v))} options={weekdays.map((d, i) => ({ value: String(i), label: d }))} />
              </Field>
            )}
            {(frequency === "Monthly" || frequency === "Quarterly" || frequency === "Yearly") && (
              <Field as="div" label="On day" hint="Days 29 to 31 are left out because short months skip them">
                <SearchSelect
                  label="Day of the month"
                  value={String(monthDay)}
                  onChange={(v) => setMonthDay(Number(v))}
                  options={[...Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `Day ${i + 1}` })), { value: "0", label: "Last day of the month" }]}
                />
              </Field>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Starts on" required>
              <input type="date" className={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Ends on" hint="Leave empty to repeat until stopped">
              <input type="date" className={field} value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <p className="flex gap-2.5 rounded-lg bg-accent-soft px-3.5 py-3 text-sm text-ink">
            <Info size={18} weight="fill" className="mt-px shrink-0 text-accent" />
            <span>
              {scheduleSentence(type, frequency, weekday, monthDay, startDate, endDate)} Nothing is posted: someone reviews and posts each draft in NAV.
            </span>
          </p>
        </section>

        <section className="grid gap-3 border-t border-line pt-6">
          <h3 className="text-sm font-semibold">Lines</h3>
          <div className="relative overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[1800px] text-sm">
              <thead className="border-b border-line bg-subtle">
                <tr>
                  <th className={`${th} w-[150px]`}>Type</th>
                  <th className={`${th} w-[230px]`}>No.</th>
                  <th className={`${th} min-w-[220px]`}>Description</th>
                  <th className={`${th} w-[120px]`}>Location Code</th>
                  <th className={`${th} w-[90px] text-right`}>Quantity</th>
                  <th className={`${th} w-[120px]`}>Unit of Measure</th>
                  <th className={`${th} w-[130px] text-right`}>{type === "Sales" ? "Unit Price Excl. VAT" : "Direct Unit Cost Excl. VAT"}</th>
                  <th className={`${th} w-[100px] text-right`}>Line Discount %</th>
                  <th className={`${th} w-[130px] text-right`}>Line Amount Excl. VAT</th>
                  {dims.map(([k, d]) => (
                    <th key={k} className={`${th} w-[210px]`}>
                      {d!.label}
                    </th>
                  ))}
                  <th className={`${th} w-10`}>
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((l, i) => {
                  const text = l.type === "";
                  const opts = nav && !text ? nav.lines[l.type as Exclude<Line["type"], "">] : [];
                  const off = text || !nav;
                  return (
                    <tr key={i}>
                      <td className="px-2 py-2">
                        <SearchSelect
                          compact
                          label="Type"
                          value={l.type}
                          options={lineTypes.map((t) => ({ value: t, label: lineTypeLabel(t) }))}
                          onChange={(v) => setLine(i, { ...blankLine(), type: v as Line["type"], description: l.description })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <SearchSelect
                          compact
                          label="No."
                          placeholder={text ? "" : !nav ? "Company first" : opts.length ? "Search" : `No ${noun[l.type as Exclude<Line["type"], "">]} in NAV`}
                          value={l.no}
                          disabled={off || opts.length === 0}
                          options={opts.map(toOpt)}
                          onChange={(v) => {
                            const picked = opts.find((o) => o.no === v);
                            const oldName = opts.find((o) => o.no === l.no)?.name;
                            // Like NAV: picking a No. fills the description and unit of measure, unless edited.
                            setLine(i, {
                              no: v,
                              ...(picked && (!l.description || l.description === oldName) ? { description: picked.name.slice(0, 50) } : {}),
                              ...(picked?.uom ? { unitOfMeasure: picked.uom } : {}),
                            });
                          }}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input className={cell} value={l.description} maxLength={50} aria-label="Description" onChange={(e) => setLine(i, { description: e.target.value })} />
                      </td>
                      <td className="px-2 py-2">
                        <SearchSelect
                          compact
                          clearable
                          label="Location Code"
                          placeholder=""
                          value={l.locationCode}
                          disabled={off || l.type !== "Item"}
                          options={(nav?.locations ?? []).map(toOpt)}
                          onChange={(v) => setLine(i, { locationCode: v })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" min={0} step="any" className={`${cell} text-right tabular-nums`} value={text ? "" : l.quantity} disabled={text} aria-label="Quantity" onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} />
                      </td>
                      <td className="px-2 py-2">
                        <SearchSelect
                          compact
                          clearable
                          label="Unit of Measure"
                          placeholder=""
                          value={l.unitOfMeasure}
                          disabled={off || (l.type !== "Item" && l.type !== "Resource")}
                          options={(nav?.unitsOfMeasure ?? []).map(toOpt)}
                          onChange={(v) => setLine(i, { unitOfMeasure: v })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" min={0} step="0.01" className={`${cell} text-right tabular-nums`} value={text ? "" : l.unitPrice} disabled={text} aria-label="Unit price" onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" min={0} max={100} step="0.01" className={`${cell} text-right tabular-nums`} value={text ? "" : l.lineDiscountPct} disabled={text} aria-label="Line discount percent" onChange={(e) => setLine(i, { lineDiscountPct: Number(e.target.value) })} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-2">{text ? "" : rm(lineAmount(l))}</td>
                      {dims.map(([k, d]) => (
                        <td key={k} className="px-2 py-2">
                          <SearchSelect compact clearable label={d!.label} placeholder="" value={l[k]} disabled={off} options={d!.values.map(toOpt)} onChange={(v) => setLine(i, { [k]: v })} />
                        </td>
                      ))}
                      <td className="px-1 py-2">
                        <button type="button" className={`${btn.icon} disabled:opacity-30`} aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                          <Trash size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-line bg-subtle">
                <tr>
                  <td colSpan={8} className="px-3 py-2.5 text-right text-sm font-semibold">
                    Total Excl. VAT (MYR)
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{rm(invoiceTotal({ lines }))}</td>
                  <td colSpan={dims.length + 1} />
                </tr>
              </tfoot>
            </table>
          </div>
          <div>
            <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-ink hover:underline" onClick={() => setLines([...lines, blankLine()])}>
              <Plus size={14} /> Add line
            </button>
          </div>
        </section>
      </form>
      {twin && (
        <Confirm
          title="This looks like a duplicate"
          action="Save anyway"
          tone="primary"
          onClose={() => setTwin(null)}
          onConfirm={async () => {
            const r = await saveInvoice(input());
            if (r.ok) onClose();
            return r;
          }}
        >
          <p>
            There is already a recurring invoice for <span className="font-medium text-ink">{twin.partyName}</span> with the same lines and schedule ({twin.schedule}, RM{" "}
            {rm(twin.total)}). Both would create a draft in NAV each time.
          </p>
          <p>Save anyway if this is meant to be a second, separate invoice.</p>
        </Confirm>
      )}
    </Dialog>
  );
}

function InvoiceDetails({ invoice: r, onEdit, onDelete, onClose }: { invoice: RecurringInvoice; onEdit: () => void; onDelete: () => void; onClose: () => void }) {
  const item = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
  return (
    <Dialog
      open
      wide
      variant="sheet"
      onClose={onClose}
      title={r.partyName}
      footer={
        <>
          <button className={btn.primary} onClick={onEdit}>
            <PencilSimple size={16} /> Edit
          </button>
          <button className={btn.secondary} onClick={onDelete}>
            <Trash size={16} /> Delete
          </button>
        </>
      }
    >
      <div className="grid gap-8 text-sm">
        <dl className="grid gap-4 sm:grid-cols-3">
          {item("Company", r.companyName)}
          {item(r.type === "Sales" ? "Customer" : "Vendor", `${r.partyNo}, ${r.partyName}`)}
          {item("Your Reference", r.yourReference || <span className="text-ink-3">None</span>)}
          {item("Invoice type", r.type)}
          {item("Status", <StatusBadge status={r.status} />)}
          {item("Next run", r.nextDate && r.status === "Active" ? `${fmtDate(r.nextDate)} (${relativeDay(r.nextDate)})` : <span className="text-ink-3">None</span>)}
        </dl>
        <p className="rounded-lg bg-subtle px-4 py-3 text-ink-2">{scheduleSentence(r.type, r.frequency, r.weekday, r.monthDay, r.startDate, r.endDate ?? "")}</p>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[900px]">
            <thead className="border-b border-line bg-subtle">
              <tr>
                <th className={th}>Type</th>
                <th className={th}>No.</th>
                <th className={th}>Description</th>
                <th className={th}>Location</th>
                <th className={`${th} text-right`}>Quantity</th>
                <th className={th}>Unit</th>
                <th className={`${th} text-right`}>{r.type === "Sales" ? "Unit Price" : "Direct Unit Cost"}</th>
                <th className={`${th} text-right`}>Disc. %</th>
                <th className={`${th} text-right`}>Line Amount</th>
                <th className={th}>Dimensions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.lines.map((l, i) => (
                <tr key={i}>
                  <td className={`${td} whitespace-nowrap`}>{lineTypeLabel(l.type)}</td>
                  <td className={`${td} whitespace-nowrap`}>{l.no}</td>
                  <td className={td}>{l.description}</td>
                  <td className={td}>{l.locationCode}</td>
                  <td className={`${td} ${num}`}>{l.type ? l.quantity : ""}</td>
                  <td className={td}>{l.unitOfMeasure}</td>
                  <td className={`${td} ${num}`}>{l.type ? rm(l.unitPrice) : ""}</td>
                  <td className={`${td} ${num}`}>{l.type && l.lineDiscountPct ? l.lineDiscountPct : ""}</td>
                  <td className={`${td} ${num}`}>{l.type ? rm(lineAmount(l)) : ""}</td>
                  <td className={td}>{[l.dim1, l.dim2].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line">
              <tr>
                <td className={`${td} font-medium`} colSpan={8}>
                  Total excl. VAT (RM)
                </td>
                <td className={`${td} ${num} font-semibold`}>{rm(invoiceTotal(r))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Dialog>
  );
}

const col = columnHelper<RecurringInvoice>();

export function InvoicesView({ companies, invoices }: { companies: Company[]; invoices: RecurringInvoice[] }) {
  const [type, setType] = useState("All");
  const [editing, setEditing] = useState<RecurringInvoice | "new" | null>(null);
  const [viewing, setViewing] = useState<RecurringInvoice | null>(null);
  const [deleting, setDeleting] = useState<RecurringInvoice | null>(null);
  const [running, setRunning] = useState<RecurringInvoice | null>(null);
  const [notice, setNotice] = useState("");
  const [, start] = useTransition();

  const shown = useMemo(() => invoices.filter((r) => type === "All" || r.type === type), [invoices, type]);
  const count = (t: string) => invoices.filter((r) => t === "All" || r.type === t).length;
  const noCompanies = !companies.some((c) => c.active);

  const columns = useMemo<Columns<RecurringInvoice>>(
    () => [
      col.accessor("companyName", { header: "Company", meta: { filter: "companies" }, cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
      col.accessor((r) => `${r.partyName} ${r.partyNo}`, {
        id: "party",
        header: "Customer / vendor",
        cell: ({ row: { original: r } }) => (
          <>
            <div className="whitespace-nowrap">{r.partyName}</div>
            <div className="text-xs text-ink-3">
              {r.type} · {r.partyNo}
            </div>
          </>
        ),
      }),
      col.accessor("yourReference", { header: "Your Reference", cell: (c) => c.getValue() || <span className="text-ink-3">None</span> }),
      col.accessor((r) => scheduleText(r), {
        id: "frequency",
        header: "Frequency",
        cell: ({ row: { original: r } }) => (
          <div className="whitespace-nowrap">
            <div>{scheduleText(r)}</div>
            <div className="text-xs text-ink-3">{r.endDate ? `Until ${fmtDate(r.endDate)}` : "No end date"}</div>
          </div>
        ),
      }),
      col.accessor((r) => (r.status === "Active" ? (r.nextDate ?? undefined) : undefined), {
        id: "next",
        header: "Next run",
        sortUndefined: "last",
        cell: ({ row: { original: r } }) =>
          r.nextDate && r.status === "Active" ? (
            <div className="whitespace-nowrap">
              <div>{fmtDate(r.nextDate)}</div>
              <div className="text-xs text-ink-3">{relativeDay(r.nextDate)}</div>
            </div>
          ) : (
            <span className="text-ink-3">{r.status === "Paused" ? "Paused" : "None"}</span>
          ),
      }),
      col.accessor((r) => invoiceTotal(r), { id: "amount", header: "Excl. VAT (RM)", sortFn: "basic", meta: { className: num }, cell: (c) => rm(c.getValue()) }),
      col.accessor("status", { header: "Status", meta: { filter: "statuses" }, cell: (c) => <StatusBadge status={c.getValue()} /> }),
      col.display({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row: { original: r } }) => (
          <RowActions name={r.partyName} onView={() => setViewing(r)} onEdit={() => setEditing(r)} onDelete={() => setDeleting(r)}>
            {r.status !== "Ended" && (
              <button className={btn.icon} aria-label={`Run now: ${r.partyName}`} title="Run now: create today's draft in NAV" onClick={() => setRunning(r)}>
                <Lightning size={16} />
              </button>
            )}
            {r.status !== "Ended" && (
              <button
                className={btn.icon}
                aria-label={`${r.status === "Paused" ? "Resume" : "Pause"} ${r.partyName}`}
                title={r.status === "Paused" ? "Resume" : "Pause"}
                onClick={() => start(async () => void (await setInvoiceStatus(r.id, r.status === "Paused" ? "Active" : "Paused")))}
              >
                {r.status === "Paused" ? <Play size={16} /> : <Pause size={16} />}
              </button>
            )}
          </RowActions>
        ),
      }),
    ],
    [],
  );

  return (
    <>
      <PageHeader
        guide="recurring-invoices"
        title="Recurring invoices"
        description="Sales and purchase invoices created in NAV on a schedule, as drafts for review."
        actions={
          <button data-tour="new-invoice" className={`${btn.primary} disabled:pointer-events-none disabled:opacity-50`} disabled={noCompanies} onClick={() => setEditing("new")}>
            <Plus size={16} weight="bold" /> New recurring invoice
          </button>
        }
      />

      {notice && (
        <p role="status" className="mb-4 flex items-start gap-2.5 rounded-lg bg-good-soft px-3.5 py-3 text-sm text-good">
          <CheckCircle size={18} weight="fill" className="mt-px shrink-0" />
          {notice}
        </p>
      )}

      <section className={panel}>
        <div className="flex gap-6 border-b border-line px-5" role="tablist">
          {["All", "Sales", "Purchase"].map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={type === t}
              onClick={() => setType(t)}
              className={`-mb-px border-b-2 py-3 text-sm transition-colors ${type === t ? "border-accent font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
            >
              {t} <span className="text-ink-3">{count(t)}</span>
            </button>
          ))}
        </div>
        <DataTable
          data={shown}
          columns={columns}
          minWidth={1000}
          search="Search company, customer, vendor or reference"
          empty={
            invoices.length === 0
              ? { title: "No recurring invoices yet", hint: noCompanies ? "IT needs to add a company in Settings first." : "Create the first one with New recurring invoice." }
              : { title: `No ${type.toLowerCase()} invoices`, hint: "Switch to All to see the rest." }
          }
        />
      </section>

      {viewing && (
        <InvoiceDetails
          invoice={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => (setViewing(null), setEditing(viewing))}
          onDelete={() => (setViewing(null), setDeleting(viewing))}
        />
      )}
      {editing && <InvoiceForm key={editing === "new" ? "new" : editing.id} invoice={editing} companies={companies} onClose={() => setEditing(null)} />}
      {running && (
        <Confirm
          title="Create a draft in NAV now?"
          action="Create draft"
          tone="primary"
          onClose={() => setRunning(null)}
          onConfirm={async () => {
            setNotice("");
            const r = await runInvoiceNow(running.id);
            if (r.ok) setNotice(r.data);
            return r;
          }}
        >
          <p>
            Creates today&apos;s {running.type.toLowerCase()} invoice for <span className="font-medium text-ink">{running.partyName}</span> ({running.companyName}) in NAV as a
            draft, assigned to you. It is not posted.
          </p>
          <p>If today&apos;s draft already exists, nothing new is created. If today is a scheduled day, this counts as that run.</p>
        </Confirm>
      )}
      {deleting && (
        <Confirm title="Delete recurring invoice?" onClose={() => setDeleting(null)} onConfirm={() => deleteInvoice(deleting.id)}>
          <p>
            The schedule for <span className="font-medium text-ink">{deleting.partyName}</span> ({deleting.companyName}) and its run history are deleted. Drafts it already created in NAV stay in NAV.
          </p>
          <p>To stop it for a while instead, pause it.</p>
        </Confirm>
      )}
    </>
  );
}
