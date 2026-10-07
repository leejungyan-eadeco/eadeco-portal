import { listCompanies, listInvoices } from "@/lib/store";
import { InvoicesView } from "./view";

export const dynamic = "force-dynamic";

export default async function RecurringInvoices() {
  const [companies, invoices] = await Promise.all([listCompanies(), listInvoices()]);
  return <InvoicesView companies={companies} invoices={invoices} />;
}
