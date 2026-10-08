import { currentUser } from "@/lib/auth";
import { listCompanies, listParkingRuns, listParkingSetups } from "@/lib/store";
import { ParkingView } from "./view";

export const dynamic = "force-dynamic";

export default async function ParkingReports() {
  const [setups, runs, companies, user] = await Promise.all([listParkingSetups(), listParkingRuns(1000), listCompanies(), currentUser()]);
  return <ParkingView setups={setups} runs={runs} companies={companies} admin={user?.role === "admin"} />;
}
