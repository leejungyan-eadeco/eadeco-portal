// NAV 2018 web services (OData V4).
// Server address and sign-in come from .env; each service name is configurable in Settings > NAV connection.
import { db } from "./db";
import type { InvoiceType, Line, NavLookups, Option } from "./types";

export const navServiceDefs = [
  { key: "customers", label: "Customers", page: "Customer Card (21)", fallback: "CustomerCard" },
  { key: "vendors", label: "Vendors", page: "Vendor Card (26)", fallback: "VendorCard" },
  { key: "glAccounts", label: "G/L accounts", page: "Chart of Accounts (17)", fallback: "ChartOfAccounts" },
  { key: "items", label: "Items", page: "Item List (31)", fallback: "Items" },
  { key: "resources", label: "Resources", page: "Resource List (77)", fallback: "ResourceList" },
  { key: "fixedAssets", label: "Fixed assets", page: "Fixed Asset Card (5600)", fallback: "FixedAssetCard" },
  { key: "itemCharges", label: "Item charges", page: "Item Charges (5800)", fallback: "ItemCharges" },
  { key: "locations", label: "Locations", page: "Location List (15)", fallback: "LocationList" },
  { key: "unitsOfMeasure", label: "Units of measure", page: "Units of Measure (209)", fallback: "UnitOfMeasure" },
  { key: "dimensionValues", label: "Dimension values", page: "Dimension Value List (560)", fallback: "DimensionValueList" },
  { key: "glSetup", label: "General ledger setup", page: "General Ledger Setup (118)", fallback: "GeneralLedgerSetup" },
  // Drafts. The standard Sales Invoice line page refuses Quantity over web services
  // ('Property "Editable" for Quantity is invalid!'), so drafts go through the custom pages e-invoice also uses,
  // and the standard pages only fill the few fields those lack.
  { key: "salesInvoice", label: "Sales invoice: create drafts", page: "Custom page", fallback: "ws_WS_SalesInvoice" },
  { key: "salesInvoiceLines", label: "Sales invoice lines", page: "Custom page", fallback: "ws_WS_SalesInvoiceSalesLines" },
  { key: "salesLinesStandard", label: "Sales invoice lines: unit of measure", page: "Sales Invoice Subform (47)", fallback: "Sales_InvoiceSalesLines" },
  { key: "purchaseInvoice", label: "Purchase invoice: create drafts", page: "Custom page", fallback: "ws_VMS_PurchInv" },
  { key: "purchaseInvoiceLines", label: "Purchase invoice lines", page: "Custom page", fallback: "ws_VMS_PurchInvPurchLines" },
  { key: "purchaseInvoiceStandard", label: "Purchase invoice: Assigned User ID", page: "Purchase Invoice (51)", fallback: "PurchaseInvoice" },
  { key: "purchaseLinesStandard", label: "Purchase invoice lines: discount, unit of measure", page: "Purch. Invoice Subform (55)", fallback: "PurchaseInvoicePurchLines" },
] as const;
export type NavServiceKey = (typeof navServiceDefs)[number]["key"];
export type NavServices = Record<NavServiceKey, string>;

export class NavNotConfigured extends Error {
  constructor() {
    super("NAV is not connected yet: an admin sets the server address in Settings > NAV connection.");
  }
}

// The server address is kept in the database (Settings > NAV connection), the sign-in in .env.
export async function navBaseUrl(): Promise<string> {
  const { rows } = await db.query<{ base_url: string }>(`select base_url from nav_settings`);
  return (rows[0]?.base_url ?? "").replace(/\/+$/, "");
}

export function navConnection() {
  const auth = (process.env.NAV_AUTH || "current") as "current" | "windows" | "navuser";
  const account = auth === "current" ? "Windows account running the portal" : auth === "windows" ? `${process.env.NAV_DOMAIN}\\${process.env.NAV_USERNAME}` : process.env.NAV_USERNAME ?? "";
  return { auth, account };
}

// Service names saved in Settings, falling back to the standard names.
export async function navServices(): Promise<NavServices> {
  const { rows } = await db.query<{ key: string; service_name: string }>(`select key, service_name from nav_services`);
  const saved = Object.fromEntries(rows.map((r) => [r.key, r.service_name]));
  return Object.fromEntries(navServiceDefs.map((d) => [d.key, saved[d.key] || d.fallback])) as NavServices;
}

// ---------- Sign-in ----------

// current / windows: Kerberos through Windows (SSPI), like a browser on the domain. navuser: NAV user password (Basic).
async function authorization(host: string): Promise<string> {
  const { auth } = navConnection();
  if (auth === "navuser") return `Basic ${Buffer.from(`${process.env.NAV_USERNAME}:${process.env.NAV_PASSWORD}`).toString("base64")}`;

  const { default: sspiPkg } = await import("node-expose-sspi");
  const { sspi } = sspiPkg;
  const authData = auth === "windows" ? { domain: process.env.NAV_DOMAIN ?? "", user: process.env.NAV_USERNAME ?? "", password: process.env.NAV_PASSWORD ?? "" } : undefined;
  const { credential } = sspi.AcquireCredentialsHandle({ packageName: "Negotiate", ...(authData ? { authData } : {}) });
  try {
    const ctx = sspi.InitializeSecurityContext({ credential, targetName: `HTTP/${host}` });
    if (ctx.contextHandle) sspi.DeleteSecurityContext(ctx.contextHandle);
    return `Negotiate ${Buffer.from(ctx.SecBufferDesc.buffers[0]).toString("base64")}`;
  } catch (e) {
    throw new Error(`Windows refused the NAV sign-in for ${navConnection().account}: ${e instanceof Error ? e.message : e}`);
  } finally {
    sspi.FreeCredentialsHandle(credential);
  }
}

// The route to NAV drops some connections (e-invoice measured ~13%). Only failed *connects* are retried:
// the request never reached NAV, so a retried POST cannot create a second record.
const connectFailed = (e: unknown) => /UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|ETIMEDOUT/.test(String((e as { cause?: { code?: string } })?.cause?.code));

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", pathOrUrl: string, body?: unknown) {
  const base = await navBaseUrl();
  if (!base) throw new NavNotConfigured();
  const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${base}/ODataV4/${pathOrUrl}`);
  let res: Response | undefined;
  for (let attempt = 1; !res; attempt++) {
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: await authorization(url.hostname),
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(method === "PATCH" || method === "DELETE" ? { "If-Match": "*" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120_000), // a cold NAV can take ~25s for a card page
        cache: "no-store",
      });
    } catch (e) {
      if (attempt >= 4 || !connectFailed(e)) throw e;
    }
  }
  if (!res.ok) {
    const text = await res.text();
    let detail = text.slice(0, 300);
    try {
      detail = JSON.parse(text).error?.message ?? detail;
    } catch {}
    // Name the service, not the whole address: the key part of a URL is long, unbroken and says nothing new.
    const service = decodeURIComponent(url.pathname.split("/").pop() ?? "").replace(/\(.*$/, "");
    throw new Error(`NAV refused the request to ${service} (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return res.status === 204 ? null : res.json();
}
const getJson = (pathOrUrl: string) => call("GET", pathOrUrl);

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

// Reads every page of a list (NAV returns large lists in pages).
async function list<T>(company: string, service: string, select: string, filter?: string): Promise<T[]> {
  let next: string | undefined =
    `${encodeURIComponent(service)}?company=${encodeURIComponent(company)}&$select=${encodeURIComponent(select)}` +
    (filter ? `&$filter=${encodeURIComponent(filter)}` : "");
  const out: T[] = [];
  while (next) {
    const page = await getJson(next);
    out.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return out;
}

// ---------- Public API ----------

export async function navCompanies(): Promise<string[]> {
  const page = await getJson("Company?$select=Name");
  return (page.value as { Name: string }[]).map((c) => c.Name);
}

// Reads one record to prove a service is published and readable.
export async function testNavService(service: string, company: string): Promise<string> {
  const page = await getJson(`${encodeURIComponent(service)}?company=${encodeURIComponent(company)}&$top=1`);
  return page.value.length ? "Published and readable" : "Published and readable (no records in this company)";
}

type Row = Record<string, string>;
const opt = (no: string, name: string, uom?: string): Option => (uom ? { no, name, uom } : { no, name });

async function dimension(company: string, s: NavServices, code: string): Promise<NavLookups["dim1"]> {
  if (!code) return null;
  const rows = await list<Row>(company, s.dimensionValues, "Code,Name", `Dimension_Code eq ${quote(code)} and Blocked eq false and Dimension_Value_Type eq 'Standard'`);
  return { label: code, values: rows.map((r) => opt(r.Code, r.Name)) };
}

// NAV lists per company, kept for 10 minutes: the first load can take several seconds (card pages are slow).
// ponytail: in-process memory cache; new NAV records show up within 10 minutes. Move to a shared cache if the portal runs on several servers.
const TTL = 10 * 60_000;
const g = globalThis as unknown as { navCache?: Map<string, { at: number; data: Promise<NavLookups> }> };
const cache = (g.navCache ??= new Map());

export function clearNavCache() {
  cache.clear();
}

export function navLookups(company: string): Promise<NavLookups> {
  const hit = cache.get(company);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = loadLookups(company).catch((e) => {
    cache.delete(company); // don't keep a failure
    throw e;
  });
  cache.set(company, { at: Date.now(), data });
  return data;
}

async function loadLookups(company: string): Promise<NavLookups> {
  const s = await navServices();
  const [setup] = await list<Row>(company, s.glSetup, "Global_Dimension_1_Code,Global_Dimension_2_Code");

  const [customers, vendors, gl, items, resources, fixedAssets, charges, locations, unitsOfMeasure, dim1, dim2] = await Promise.all([
    list<Row>(company, s.customers, "No,Name", "Blocked ne 'Invoice' and Blocked ne 'All'"),
    list<Row>(company, s.vendors, "No,Name", "Blocked ne 'All'"),
    // Only posting accounts that allow direct posting can go on an invoice line.
    list<Row>(company, s.glAccounts, "No,Name", "Account_Type eq 'Posting' and Direct_Posting eq true and Blocked eq false"),
    list<Row>(company, s.items, "No,Description,Base_Unit_of_Measure", "Blocked eq false"),
    // ponytail: Resource List and Fixed Asset Card don't expose Blocked; NAV still refuses blocked ones when the draft is created.
    list<Row>(company, s.resources, "No,Name,Base_Unit_of_Measure"),
    list<Row>(company, s.fixedAssets, "No,Description"),
    list<Row>(company, s.itemCharges, "No,Description"),
    list<Row>(company, s.locations, "Code,Name"),
    list<Row>(company, s.unitsOfMeasure, "Code,Description"),
    dimension(company, s, setup?.Global_Dimension_1_Code ?? ""),
    dimension(company, s, setup?.Global_Dimension_2_Code ?? ""),
  ]);

  return {
    customers: customers.map((r) => opt(r.No, r.Name)),
    vendors: vendors.map((r) => opt(r.No, r.Name)),
    lines: {
      "G/L Account": gl.map((r) => opt(r.No, r.Name)),
      Item: items.map((r) => opt(r.No, r.Description, r.Base_Unit_of_Measure)),
      Resource: resources.map((r) => opt(r.No, r.Name, r.Base_Unit_of_Measure)),
      "Fixed Asset": fixedAssets.map((r) => opt(r.No, r.Description)),
      "Charge (Item)": charges.map((r) => opt(r.No, r.Description)),
    },
    locations: locations.map((r) => opt(r.Code, r.Name)),
    unitsOfMeasure: unitsOfMeasure.map((r) => opt(r.Code, r.Description)),
    dim1,
    dim2,
  };
}

// ---------- Drafts (write) ----------

export type DraftInput = {
  type: InvoiceType;
  partyNo: string;
  yourReference: string;
  postingDate: string;
  assignedUserId: string; // e.g. EADECO\JENYEE; "" leaves it blank
  lines: Line[];
};

// Creates an unposted invoice in NAV and returns its No. Never posts.
// If anything after the header is refused, the half-made draft is deleted so NAV is left as it was.
export async function createNavDraft(company: string, d: DraftInput): Promise<string> {
  const s = await navServices();
  const sales = d.type === "Sales";
  // ?company= rather than Company('..')/, which breaks on names with a "/".
  const at = (service: string, key = "") => `${encodeURIComponent(service)}${key}?company=${encodeURIComponent(company)}`;
  const header = sales ? s.salesInvoice : s.purchaseInvoice;

  const created = await call("POST", at(header), {
    ...(sales ? { Sell_to_Customer_No: d.partyNo, Document_Date: d.postingDate } : { Buy_from_Vendor_No: d.partyNo }),
    ...(d.yourReference ? { Your_Reference: d.yourReference } : {}),
    Posting_Date: d.postingDate,
    ...(sales && d.assignedUserId ? { Assigned_User_ID: d.assignedUserId } : {}),
  });
  const no: string = created.No;
  const docKey = `(Document_Type='Invoice',No=${encodeURIComponent(quote(no))})`;

  try {
    // The purchase custom page has no Assigned User ID; the standard page sets it.
    if (!sales && d.assignedUserId) await call("PATCH", at(s.purchaseInvoiceStandard, docKey), { Assigned_User_ID: d.assignedUserId });

    for (const [i, l] of d.lines.entries()) {
      const lineNo = (i + 1) * 10000;
      await call("POST", at(sales ? s.salesInvoiceLines : s.purchaseInvoiceLines), {
        Document_Type: "Invoice",
        Document_No: no,
        Line_No: lineNo,
        ...(l.type
          ? {
              Type: l.type, // NAV wants the caption itself, e.g. "G/L Account"
              No: l.no,
              ...(l.description ? { Description: l.description } : {}),
              ...(l.locationCode ? { Location_Code: l.locationCode } : {}),
              Quantity: l.quantity,
              ...(sales ? { Unit_Price: l.unitPrice } : { Direct_Unit_Cost: l.unitPrice }),
              ...(sales && l.lineDiscountPct ? { Line_Discount_Percent: l.lineDiscountPct } : {}),
              ...(l.dim1 ? { Shortcut_Dimension_1_Code: l.dim1 } : {}),
              ...(l.dim2 ? { Shortcut_Dimension_2_Code: l.dim2 } : {}),
            }
          : { Description: l.description }),
      });
      // Fields the custom line pages lack, set on the standard line page.
      const extra = {
        ...(l.type && l.unitOfMeasure ? { Unit_of_Measure_Code: l.unitOfMeasure } : {}),
        ...(!sales && l.type && l.lineDiscountPct ? { Line_Discount_Percent: l.lineDiscountPct } : {}),
      };
      if (Object.keys(extra).length)
        await call("PATCH", at(sales ? s.salesLinesStandard : s.purchaseLinesStandard, `(Document_Type='Invoice',Document_No=${encodeURIComponent(quote(no))},Line_No=${lineNo})`), extra);
    }
  } catch (e) {
    try {
      await call("DELETE", at(header, docKey));
    } catch (cleanup) {
      throw new Error(`${e instanceof Error ? e.message : e} The half-made draft ${no} could not be removed (${cleanup instanceof Error ? cleanup.message : cleanup}); delete it in NAV.`);
    }
    throw e;
  }
  return no;
}
