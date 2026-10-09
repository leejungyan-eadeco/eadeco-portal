"use client";

import { useState } from "react";
import Link from "next/link";
import { DownloadSimple, GearSix } from "@phosphor-icons/react";
import { todayMY } from "@/lib/schedule";
import type { Company, ParkingRun, ParkingSetupRow } from "@/lib/types";
import { Confirm } from "../../dialog";
import { runParkingNow } from "../../parking-actions";
import { SearchSelect } from "../../select";
import { btn, EmptyState, Field, field, PageHeader, panel } from "../../ui";
import { DaysTab } from "./days";
import { SetupForm } from "./setup-form";

const minusDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

// ---------- Page: one setup ----------

// The setup only: what it is set to and who changed it. Its runs are in Activity with every other automation's.
export function ParkingView({ setups, runs, companies, admin }: { setups: ParkingSetupRow[]; runs: ParkingRun[]; companies: Company[]; admin: boolean }) {
  const [setupId, setSetupId] = useState(setups[0]?.id);
  const [editing, setEditing] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [date, setDate] = useState(() => minusDay(todayMY()));
  const [notice, setNotice] = useState("");
  const s = setups.find((x) => x.id === setupId) ?? setups[0];

  // New parking portals need their clicking steps written first, so setups are added by IT.
  if (!s)
    return (
      <>
        <PageHeader title="Parking Reports" description="Each day's report from a carpark's parking portal becomes one sales invoice draft in NAV." />
        <section className={panel}>
          <EmptyState title="No parking setups yet" hint="IT adds a setup for each carpark's parking portal. Ask IT to add one." />
        </section>
      </>
    );

  return (
    <>
      <PageHeader
        title="Parking Reports"
        description={
          <>
            Automatically retrieves the daily report of {s.name} from its parking portal (
            <a href={s.portalUrl} target="_blank" rel="noreferrer" className="font-medium text-accent-ink hover:underline">
              WhizzParking
            </a>
            ) and creates one sales invoice draft in NAV for each day. Each run is listed in{" "}
            <Link href={`/activity?automation=${encodeURIComponent("Parking report")}`} className="font-medium text-accent-ink hover:underline">
              Activity
            </Link>
            .
          </>
        }
        actions={
          <>
            <button className={btn.secondary} onClick={() => (setNotice(""), setFetching(true))}>
              <DownloadSimple size={16} /> Fetch a day
            </button>
            <button className={btn.primary} onClick={() => (setNotice(""), setEditing(true))}>
              <GearSix size={16} /> Configuration
            </button>
          </>
        }
      />

      {/* Several carparks: pick which one this page shows. */}
      {setups.length > 1 && (
        <div className="-mt-4 mb-6 w-64">
          <SearchSelect label="Setup" value={String(s.id)} options={setups.map((x) => ({ value: String(x.id), label: x.name }))} onChange={(v) => setSetupId(Number(v))} />
        </div>
      )}

      {notice && <p className="mb-4 rounded-lg bg-good-soft px-3.5 py-3 text-sm text-good">{notice}</p>}

      <section className={panel}>
        <DaysTab runs={runs.filter((r) => r.setupId === s.id)} onNotice={setNotice} />
      </section>

      {editing && (
        <SetupForm
          edit={s}
          companies={companies}
          onClose={() => setEditing(false)}
          onSaved={(m) => {
            setEditing(false);
            setNotice(m);
          }}
        />
      )}
      {fetching && (
        <Confirm
          title={`Fetch a day for ${s.name}`}
          action="Fetch"
          tone="primary"
          onClose={() => setFetching(false)}
          onConfirm={async () => {
            const r = await runParkingNow(s.id, date);
            if (r.ok) setNotice(r.data);
            return r;
          }}
        >
          <div className="grid gap-3">
            <Field label="Report date" required>
              <input type="date" className={field} value={date} max={minusDay(todayMY())} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <p>Gets that day&apos;s report and creates its draft in NAV. Follow it in Activity.</p>
          </div>
        </Confirm>
      )}
    </>
  );
}
