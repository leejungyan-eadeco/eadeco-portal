import { listParkingRuns, listParkingSetups, listRuns } from "@/lib/store";
import { PageHeader, panel } from "../ui";
import { RunsTable } from "./view";

export const dynamic = "force-dynamic";

// ?automation=Parking report opens the list filtered to that automation (links from its page).
export default async function Activity({ searchParams }: { searchParams: Promise<{ automation?: string }> }) {
  const [runs, parkingRuns, setups, { automation }] = await Promise.all([listRuns(), listParkingRuns(), listParkingSetups(), searchParams]);

  return (
    <>
      <PageHeader guide="runs" title="Activity" description="Every run of every automation, newest first. A retried run never creates a duplicate draft in NAV." />
      <section className={panel}>
        <RunsTable runs={runs} parkingRuns={parkingRuns} setups={setups} automation={automation} />
      </section>
    </>
  );
}
