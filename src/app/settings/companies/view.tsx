"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { CheckCircle, CircleNotch, Plus, PlugsConnected, WarningCircle } from "@phosphor-icons/react";
import type { Company } from "@/lib/types";
import { deleteCompany, getNavCompanies, saveCompany, setCompanyActive, testCompanyNav } from "../../actions";
import { columnHelper, DataTable, RowActions, type Columns } from "../../data-table";
import { Confirm, Dialog, ErrorNote } from "../../dialog";
import { SearchSelect } from "../../select";
import { btn, Field, field, PageHeader, panel, Toggle } from "../../ui";

function CompanyForm({ company, taken, onClose }: { company: Company | "new"; taken: string[]; onClose: () => void }) {
  const edit = company === "new" ? null : company;
  const [navCompany, setNavCompany] = useState(edit?.navCompany ?? "");
  const [name, setName] = useState(edit?.name ?? "");
  const [active, setActive] = useState(edit?.active ?? true);
  const [nav, setNav] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [saving, start] = useTransition();

  useEffect(() => {
    getNavCompanies().then((r) => (r.ok ? setNav(r.data) : setError(r.error)));
  }, []);

  const save = () =>
    start(async () => {
      const r = await saveCompany({ code: edit?.code, name, navCompany, active });
      if (r.ok) onClose();
      else setError(r.error);
    });

  // A NAV company can only be set up once; keep the one this record already uses.
  const options = (nav ?? []).filter((n) => n === edit?.navCompany || !taken.includes(n));

  return (
    <Dialog
      open
      variant="sheet"
      onClose={onClose}
      title={edit ? `Edit ${edit.name}` : "Add company"}
      footer={
        <>
          <button className={`${btn.primary} disabled:pointer-events-none disabled:opacity-50`} disabled={saving || !navCompany || !name} onClick={save}>
            {saving ? "Saving" : edit ? "Save changes" : "Add company"}
          </button>
          <button className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <form className="grid gap-5" onSubmit={(e) => (e.preventDefault(), save())}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field as="div" label="Company in NAV" required hint={nav ? "From NAV's company list" : error ? "NAV list unavailable" : "Loading NAV's company list"}>
          <SearchSelect
            label="Company in NAV"
            placeholder="Search NAV companies"
            value={navCompany}
            disabled={!nav}
            options={options.map((n) => ({ value: n, label: n }))}
            onChange={(v) => {
              setNavCompany(v);
              if (!name) setName(v);
            }}
          />
        </Field>
        <Field label="Display name" required hint="How the company is shown in the portal">
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex items-center gap-3 text-sm">
          <Toggle checked={active} onChange={setActive} label="Active" />
          Active: its recurring invoices run on schedule
        </div>
      </form>
    </Dialog>
  );
}

const col = columnHelper<Company>();

export function CompaniesView({ companies }: { companies: Company[] }) {
  const [editing, setEditing] = useState<Company | "new" | null>(null);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [test, setTest] = useState<{ name: string; state: "running" | "ok" | "failed"; text: string } | null>(null);
  const [, start] = useTransition();

  const runTest = async (c: Company) => {
    setTest({ name: c.name, state: "running", text: "Reading its lists from NAV (can take up to a minute the first time)" });
    const r = await testCompanyNav(c.code);
    setTest({ name: c.name, state: r.ok ? "ok" : "failed", text: r.ok ? r.data : r.error });
  };

  const columns = useMemo<Columns<Company>>(
    () => [
      col.accessor((c) => `${c.name} ${c.code}`, {
        id: "company",
        header: "Company",
        cell: ({ row: { original: c } }) => (
          <>
            <div className="font-medium">{c.name}</div>
            <div className="text-xs text-ink-3">{c.code}</div>
          </>
        ),
      }),
      col.accessor("navCompany", { header: "Company in NAV" }),
      col.accessor((c) => (c.active ? "Active" : "Inactive"), {
        id: "active",
        header: "Active",
        meta: { filter: "statuses" },
        cell: ({ row: { original: c } }) => <Toggle checked={c.active} label={`${c.name} active`} onChange={(v) => start(async () => void (await setCompanyActive(c.code, v)))} />,
      }),
      col.display({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row: { original: c } }) => (
          <RowActions name={c.name} onEdit={() => setEditing(c)} onDelete={() => setDeleting(c)}>
            <button className={btn.icon} title="Test NAV access in this company" aria-label={`Test NAV access in ${c.name}`} onClick={() => runTest(c)}>
              <PlugsConnected size={16} />
            </button>
          </RowActions>
        ),
      }),
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Companies"
        description="Companies EADEPRO handles. Set up by IT; the rest of the portal picks from this list."
        actions={
          <button className={btn.primary} onClick={() => setEditing("new")}>
            <Plus size={16} weight="bold" /> Add company
          </button>
        }
      />

      {test && (
        <p
          role="status"
          className={`mb-4 flex gap-2 rounded-lg px-3.5 py-3 text-sm ${test.state === "ok" ? "bg-good-soft text-good" : test.state === "failed" ? "bg-bad-soft text-bad" : "bg-subtle text-ink-2"}`}
        >
          {test.state === "running" ? <CircleNotch size={18} className="mt-px shrink-0 animate-spin" /> : test.state === "ok" ? <CheckCircle size={18} weight="fill" className="mt-px shrink-0" /> : <WarningCircle size={18} weight="fill" className="mt-px shrink-0" />}
          <span>
            <span className="font-medium">{test.name}:</span> {test.text}
          </span>
        </p>
      )}

      <section className={panel}>
        <DataTable
          data={companies}
          columns={columns}
          minWidth={640}
          search="Search companies"
          empty={{ title: "No companies yet", hint: "Add the first company from NAV's list to start creating recurring invoices." }}
        />
      </section>

      {editing && (
        <CompanyForm key={editing === "new" ? "new" : editing.code} company={editing} taken={companies.map((c) => c.navCompany)} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <Confirm title="Delete company?" onClose={() => setDeleting(null)} onConfirm={() => deleteCompany(deleting.code)}>
          <p>
            <span className="font-medium text-ink">{deleting.name}</span> is removed from the portal. Nothing changes in NAV.
          </p>
        </Confirm>
      )}
    </>
  );
}
