import { navBaseUrl, navConnection, navServiceDefs, navServices } from "@/lib/nav";
import { NavSettingsView } from "./view";

export const dynamic = "force-dynamic";

export default async function NavSettings() {
  const services = await navServices();
  return (
    <NavSettingsView
      connection={{ ...navConnection(), baseUrl: await navBaseUrl() }}
      services={navServiceDefs.map((d) => ({ key: d.key, label: d.label, page: d.page, fallback: d.fallback, name: services[d.key] }))}
    />
  );
}
