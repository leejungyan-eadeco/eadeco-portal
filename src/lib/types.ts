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
