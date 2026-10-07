import { Car } from "@phosphor-icons/react/ssr";
import { PageHeader, panel } from "../../ui";

// Disabled until the parking portal approach is decided. The sidebar shows it as "Soon".
export default function ParkingReports() {
  return (
    <>
      <PageHeader title="Parking reports" description="Fetching parking portal reports into NAV." />
      <div className={`${panel} flex flex-col items-center px-6 py-16 text-center`}>
        <Car size={32} className="text-ink-3" />
        <p className="mt-3 font-medium">Not available yet</p>
        <p className="mt-1 max-w-[50ch] text-sm text-ink-2">How reports are fetched from the parking portal is still being decided. This page opens once that is settled.</p>
      </div>
    </>
  );
}
