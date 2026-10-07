import { listCompanies } from "@/lib/store";
import { CompaniesView } from "./view";

export const dynamic = "force-dynamic";

export default async function Companies() {
  return <CompaniesView companies={await listCompanies()} />;
}
