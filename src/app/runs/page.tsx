import { listRuns } from "@/lib/store";
import { PageHeader, panel } from "../ui";
import { RunsTable } from "./view";

export const dynamic = "force-dynamic";

export default async function RunHistory() {
  const runs = await listRuns();

  return (
    <>
      <PageHeader guide="runs" title="Run history" description="Every scheduled run across all companies. A retried run never creates a duplicate draft in NAV." />
      <section className={panel}>
        <RunsTable runs={runs} />
      </section>
    </>
  );
}
