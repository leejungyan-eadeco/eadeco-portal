// NAV 2018 web services (OData V4).
// The server address and each service name are configurable in Settings > NAV connection; the sign-in comes from .env.
import http from "node:http";
import https from "node:https";
import { db } from "./db";
import type { InvoiceType, Line, NavLookups, Option } from "./types";

export const navServiceDefs = [
  // Customers and vendors come from light custom pages: the card pages work out balances for every row (about 20x slower).
  { key: "customers", label: "Customers", page: "Custom page", fallback: "ws_DRM_Customer" },
  { key: "vendors", label: "Vendors", page: "Custom page", fallback: "ws_VMS_Vendor" },
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
  // Read only: tells a posted draft (never re-created) from a deleted one.
  { key: "postedSalesInvoices", label: "Posted sales invoices", page: "Posted Sales Invoices (143)", fallback: "PostedSalesInvoicesList" },
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
// windows: NTLM with NAV_DOMAIN / NAV_USERNAME / NAV_PASSWORD, as e-invoice signs in. Works anywhere, Docker included.
// current: Kerberos as the Windows account running the portal (SSPI). Windows only, no password stored.
// navuser: a NAV user password (Basic), only if the NAV server uses NavUserPassword.

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Reply = { status: number; text: string };

// The part of node-expose-sspi used here, typed by hand so builds without it (Linux) still type-check.
const SSPI = "node-expose-sspi";
type Sspi = {
  AcquireCredentialsHandle(o: { packageName: string }): { credential: unknown };
  InitializeSecurityContext(o: { credential: unknown; targetName: string }): { contextHandle?: unknown; SecBufferDesc: { buffers: ArrayBuffer[] } };
  DeleteSecurityContext(handle: unknown): void;
  FreeCredentialsHandle(credential: unknown): void;
};

// One plain HTTP request on the given agent (NTLM must finish on the connection it started on).
function request(method: Method, url: URL, headers: Record<string, string>, body: string | undefined, agent: http.Agent): Promise<Reply & { challenge: string }> {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      { method, agent, headers: { ...headers, "Content-Length": String(Buffer.byteLength(body ?? "")) }, timeout: 120_000 }, // a cold NAV can take ~25s
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8"), challenge: String(res.headers["www-authenticate"] ?? "") }));
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("NAV did not answer in time"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    req.end(body);
  });
}

// NAV offers only "Negotiate"; NTLM messages are sent under that name, as Python's requests-ntlm does for e-invoice.
async function sendNtlm(method: Method, url: URL, headers: Record<string, string>, body?: string): Promise<Reply> {
  const { default: httpntlm } = await import("httpntlm");
  const { ntlm } = httpntlm;
  const account = { username: process.env.NAV_USERNAME ?? "", password: process.env.NAV_PASSWORD ?? "", domain: process.env.NAV_DOMAIN ?? "", workstation: "" };
  const agent = new (url.protocol === "https:" ? https : http).Agent({ keepAlive: true, maxSockets: 1 });
  try {
    const first = await request(method, url, { ...headers, Authorization: ntlm.createType1Message(account).replace(/^NTLM /, "Negotiate ") }, undefined, agent);
    const token = /(?:Negotiate|NTLM)\s+(\S+)/i.exec(first.challenge)?.[1];
    if (first.status !== 401 || !token) return first;
    let failed: Error | null = null;
    const type2 = ntlm.parseType2Message(`NTLM ${token}`, (e) => (failed = e));
    if (!type2) throw failed ?? new Error("NAV sent an NTLM challenge the portal could not read.");
    return await request(method, url, { ...headers, Authorization: ntlm.createType3Message(type2, account).replace(/^NTLM /, "Negotiate ") }, body, agent);
  } finally {
    agent.destroy();
  }
}

async function sendFetch(method: Method, url: URL, headers: Record<string, string>, body?: string): Promise<Reply> {
  const { auth } = navConnection();
  let authorization: string;
  if (auth === "navuser") authorization = `Basic ${Buffer.from(`${process.env.NAV_USERNAME}:${process.env.NAV_PASSWORD}`).toString("base64")}`;
  else {
    if (process.platform !== "win32") throw new Error("NAV_AUTH=current only works when the portal runs on Windows. In Docker, use NAV_AUTH=windows with NAV_DOMAIN, NAV_USERNAME and NAV_PASSWORD.");
    // Windows-only package (not installed in Docker): loaded at run time, not followed by the build.
    const { sspi } = ((await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ SSPI)) as { default: { sspi: Sspi } }).default;
    const { credential } = sspi.AcquireCredentialsHandle({ packageName: "Negotiate" });
    try {
      const ctx = sspi.InitializeSecurityContext({ credential, targetName: `HTTP/${url.hostname}` });
      if (ctx.contextHandle) sspi.DeleteSecurityContext(ctx.contextHandle);
      authorization = `Negotiate ${Buffer.from(ctx.SecBufferDesc.buffers[0]).toString("base64")}`;
    } catch (e) {
      throw new Error(`Windows refused the NAV sign-in for ${navConnection().account}: ${e instanceof Error ? e.message : e}`);
    } finally {
      sspi.FreeCredentialsHandle(credential);
    }
  }
  const res = await fetch(url, { method, headers: { ...headers, Authorization: authorization }, body, signal: AbortSignal.timeout(120_000), cache: "no-store" });
  return { status: res.status, text: await res.text() };
}

// The route to NAV drops some connections (e-invoice measured ~13%). Only failed *connects* are retried:
// the request never reached NAV, so a retried POST cannot create a second record.
const connectFailed = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return /UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|ETIMEDOUT/.test(String(err?.code ?? err?.cause?.code));
};

async function call(method: Method, pathOrUrl: string, body?: unknown) {
  const base = await navBaseUrl();
  if (!base) throw new NavNotConfigured();
  const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${base}/ODataV4/${pathOrUrl}`);
  const headers = {
    Accept: "application/json",
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(method === "PATCH" || method === "DELETE" ? { "If-Match": "*" } : {}),
  };
  const send = navConnection().auth === "windows" ? sendNtlm : sendFetch;
  let res: Reply | undefined;
  for (let attempt = 1; !res; attempt++) {
    try {
      res = await send(method, url, headers, body ? JSON.stringify(body) : undefined);
    } catch (e) {
      if (attempt >= 4 || !connectFailed(e)) throw e;
    }
  }
  if (res.status < 200 || res.status >= 300) {
    let detail = res.text.slice(0, 300);
    try {
      detail = JSON.parse(res.text).error?.message ?? detail;
    } catch {}
    // Name the service, not the whole address: the key part of a URL is long, unbroken and says nothing new.
    const service = decodeURIComponent(url.pathname.split("/").pop() ?? "").replace(/\(.*$/, "");
    throw new Error(`NAV refused the request to ${service} (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return res.status === 204 || !res.text ? null : JSON.parse(res.text);
}
const getJson = (pathOrUrl: string) => call("GET", pathOrUrl);

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
type Row = Record<string, string | boolean>;

// Reads every page of a list (NAV returns large lists in pages). Filtering happens here, not in NAV: NAV's own
// $filter is what makes these pages slow (Chart of Accounts: 5 s with a filter, 0.14 s without, for ~460 rows).
async function list<T = Row>(company: string, service: string, select: string, keep: (r: Row) => boolean = () => true): Promise<T[]> {
  let next: string | undefined = `${encodeURIComponent(service)}?company=${encodeURIComponent(company)}&$select=${encodeURIComponent(select)}`;
  const out: Row[] = [];
  while (next) {
    const page = await getJson(next);
    out.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return out.filter(keep) as T[];
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

const opt = (no: string, name: string, uom?: string): Option => (uom ? { no, name, uom } : { no, name });

// NAV lists per company, kept for 10 minutes, so reopening a form doesn't ask NAV again.
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
  const [setup] = await list(company, s.glSetup, "Global_Dimension_1_Code,Global_Dimension_2_Code");
  const str = (v: string | boolean | undefined) => String(v ?? "");
  const notBlocked = (r: Row) => r.Blocked === false;

  const [customers, vendors, gl, items, resources, fixedAssets, charges, locations, unitsOfMeasure, dimValues] = await Promise.all([
    list(company, s.customers, "No,Name,Blocked", (r) => r.Blocked !== "Invoice" && r.Blocked !== "All"),
    list(company, s.vendors, "No,Name,Blocked", (r) => r.Blocked !== "All"),
    // Only posting accounts that allow direct posting can go on an invoice line.
    list(company, s.glAccounts, "No,Name,Account_Type,Direct_Posting,Blocked", (r) => r.Account_Type === "Posting" && r.Direct_Posting === true && notBlocked(r)),
    list(company, s.items, "No,Description,Base_Unit_of_Measure,Blocked", notBlocked),
    // ponytail: Resource List and Fixed Asset Card don't expose Blocked; NAV still refuses blocked ones when the draft is created.
    list(company, s.resources, "No,Name,Base_Unit_of_Measure"),
    list(company, s.fixedAssets, "No,Description"),
    list(company, s.itemCharges, "No,Description"),
    list(company, s.locations, "Code,Name"),
    list(company, s.unitsOfMeasure, "Code,Description"),
    list(company, s.dimensionValues, "Dimension_Code,Code,Name,Blocked,Dimension_Value_Type", (r) => notBlocked(r) && r.Dimension_Value_Type === "Standard"),
  ]);
  const dimension = (code: string): NavLookups["dim1"] =>
    code ? { label: code, values: dimValues.filter((r) => r.Dimension_Code === code).map((r) => opt(str(r.Code), str(r.Name))) } : null;

  return {
    customers: customers.map((r) => opt(str(r.No), str(r.Name))),
    vendors: vendors.map((r) => opt(str(r.No), str(r.Name))),
    lines: {
      "G/L Account": gl.map((r) => opt(str(r.No), str(r.Name))),
      Item: items.map((r) => opt(str(r.No), str(r.Description), str(r.Base_Unit_of_Measure))),
      Resource: resources.map((r) => opt(str(r.No), str(r.Name), str(r.Base_Unit_of_Measure))),
      "Fixed Asset": fixedAssets.map((r) => opt(str(r.No), str(r.Description))),
      "Charge (Item)": charges.map((r) => opt(str(r.No), str(r.Description))),
    },
    locations: locations.map((r) => opt(str(r.Code), str(r.Name))),
    unitsOfMeasure: unitsOfMeasure.map((r) => opt(str(r.Code), str(r.Description))),
    dim1: dimension(str(setup?.Global_Dimension_1_Code)),
    dim2: dimension(str(setup?.Global_Dimension_2_Code)),
  };
}

// Proves the portal's NAV account can work in one company: reads every list the invoice form uses (fresh, not
// cached) and checks the draft services answer there. Web services are published for the whole database, but
// permissions and setup are per company, so this is what a new company needs. Nothing is written.
export async function testCompanyAccess(company: string): Promise<string> {
  const s = await navServices();
  const l = await loadLookups(company);
  cache.set(company, { at: Date.now(), data: Promise.resolve(l) });
  for (const service of [s.salesInvoice, s.salesInvoiceLines, s.purchaseInvoice, s.purchaseInvoiceLines]) await testNavService(service, company);
  const dims = [l.dim1, l.dim2].filter(Boolean).map((d) => `${d!.label} (${d!.values.length})`);
  return `${l.customers.length} customers, ${l.vendors.length} vendors, ${l.lines["G/L Account"].length} G/L accounts${dims.length ? `, dimensions ${dims.join(" and ")}` : ", no dimensions set up"}. The draft services answer in this company.`;
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
// What became of a draft the portal created: still a draft, posted (the posted invoice keeps the draft's number as
// Pre-Assigned No.), or gone (deleted in NAV).
export async function navDraftState(company: string, draftNo: string): Promise<{ state: "draft" } | { state: "posted"; no: string } | { state: "gone" }> {
  const s = await navServices();
  const q = (service: string, filter: string, select: string) =>
    getJson(`${encodeURIComponent(service)}?company=${encodeURIComponent(company)}&$filter=${encodeURIComponent(filter)}&$select=${select}`).then((p) => p.value as Row[]);
  if ((await q(s.salesInvoice, `No eq ${quote(draftNo)}`, "No")).length) return { state: "draft" };
  const [posted] = await q(s.postedSalesInvoices, `Pre_Assigned_No eq ${quote(draftNo)}`, "No");
  return posted ? { state: "posted", no: String(posted.No) } : { state: "gone" };
}

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
