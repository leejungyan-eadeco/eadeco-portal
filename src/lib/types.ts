// Shared shapes and constants (safe for both server and browser code).

export type InvoiceType = "Sales" | "Purchase";

// NAV line types, in NAV's order. "" is NAV's blank type: a text-only line.
export const lineTypes = ["", "G/L Account", "Item", "Resource", "Fixed Asset", "Charge (Item)"] as const;
export type LineType = (typeof lineTypes)[number];
export const lineTypeLabel = (t: LineType) => t || "Text line";

export const frequencies = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"] as const;
export type Frequency = (typeof frequencies)[number];
export const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export type Option = { no: string; name: string; uom?: string };

export type Company = { code: string; name: string; navCompany: string; active: boolean };

export type Line = {
  type: LineType;
  no: string;
  description: string;
  locationCode: string;
  quantity: number;
  unitOfMeasure: string;
  unitPrice: number; // Unit Price Excl. VAT (sales) / Direct Unit Cost Excl. VAT (purchase)
  lineDiscountPct: number;
  dim1: string;
  dim2: string;
};

export type RecurringInvoice = {
  id: number;
  company: string; // code
  companyName: string;
  type: InvoiceType;
  partyNo: string;
  partyName: string;
  yourReference: string;
  frequency: Frequency;
  weekday: number; // 0 = Monday
  monthDay: number; // 1-28, 0 = last day of the month
  startDate: string;
  endDate: string | null;
  nextDate: string | null;
  status: "Active" | "Paused" | "Ended";
  lines: Line[];
};

export type Run = {
  id: number;
  at: string;
  invoiceId: number;
  company: string;
  companyName: string;
  partyName: string;
  periodDate: string;
  result: "Created" | "Failed";
  navDocument: string | null;
  error: string | null;
  errorCode: string | null;
  note: string | null;
  triggeredBy: string | null;
};

// ---------- Parking report ----------

// One NAV line: the total of every row whose payment type is in `values`.
export type ParkingLine = { label: string; values: string[]; glAccount: string; description: string; dim1: string; dim2: string };
// Each amount is found by its header text in the header row, so a moved column is still read right.
export type ParkingColumns = { net: string; sst: string; type: string };
// The day's SST from the report on its own line (finance's way), instead of leaving tax to NAV's VAT setup.
export type ParkingSstLine = { glAccount: string; description: string; dim1: string; dim2: string };
// Only rows whose value in `column` is one of `values` count (e.g. Status "pay succeed"); unpaid tickets are left out.
export type ParkingCountOnly = { column: string; values: string[] };

// One carpark / portal account. The password never leaves the server; hasPassword says whether one is saved.
export type ParkingSetup = {
  id: number;
  name: string;
  portalUrl: string;
  username: string;
  hasPassword: boolean;
  companyCode: string | null;
  customerNo: string;
  startDate: string;
  headerRow: number;
  columns: ParkingColumns;
  lines: ParkingLine[];
  sstLine: ParkingSstLine | null;
  countOnly: ParkingCountOnly | null;
  status: "Active" | "Paused";
  schedule: string;
  catchUpDays: number;
};
export type ParkingSetupRow = ParkingSetup & { companyName: string | null; lastRunDate: string | null; lastResult: string | null; updatedBy: string | null; updatedAt: string };

export type ParkingTotal = { label: string; count: number; net: number; sst: number };

export type ParkingStep = { seq: number; at: string; step: string; detail: string; ok: boolean; file: string | null; sha256: string | null };

export type ParkingRun = {
  id: number;
  setupId: number;
  setupName: string;
  companyName: string | null;
  at: string;
  reportDate: string;
  result: "Running" | "Created" | "Failed" | "Deleted";
  navDocument: string | null;
  error: string | null;
  errorCode: string | null;
  note: string | null;
  folder: string | null;
  totals: ParkingTotal[] | null;
  rowCount: number | null;
  triggeredBy: string;
  settings: Omit<ParkingSetup, "hasPassword"> | null;
  steps: ParkingStep[];
  retryAt: string | null; // ISO: when the next automatic attempt starts
};

// A day's report summed by payment type (RM), for picking columns and previewing the lines before saving.
export type ParkingSample = { date: string; headers: string[]; types: { value: string; count: number; net: number; sst: number }[] };

export type ParkingChange = { id: number; at: string; changedBy: string; action: string; changes: Record<string, { before: unknown; after: unknown }> };

// Everything the invoice form needs from NAV for one company.
export type NavLookups = {
  customers: Option[];
  vendors: Option[];
  lines: Record<Exclude<LineType, "">, Option[]>;
  locations: Option[];
  unitsOfMeasure: Option[];
  dim1: { label: string; values: Option[] } | null;
  dim2: { label: string; values: Option[] } | null;
};

export const blankLine = (): Line => ({
  type: "G/L Account",
  no: "",
  description: "",
  locationCode: "",
  quantity: 1,
  unitOfMeasure: "",
  unitPrice: 0,
  lineDiscountPct: 0,
  dim1: "",
  dim2: "",
});

export const lineAmount = (l: Line) => (l.type === "" ? 0 : l.quantity * l.unitPrice * (1 - l.lineDiscountPct / 100));
export const invoiceTotal = (i: { lines: Line[] }) => i.lines.reduce((t, l) => t + lineAmount(l), 0);

export function scheduleText(i: Pick<RecurringInvoice, "frequency" | "weekday" | "monthDay">) {
  if (i.frequency === "Daily") return "Daily";
  if (i.frequency === "Weekly") return `Weekly, ${weekdays[i.weekday].slice(0, 3)}`;
  return `${i.frequency}, ${i.monthDay === 0 ? "last day" : `day ${i.monthDay}`}`;
}
