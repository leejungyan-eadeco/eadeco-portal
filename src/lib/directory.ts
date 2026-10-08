// The EADECO user list, for picking people to invite. Read over LDAP with the AD_BIND_DN account (works anywhere,
// Docker included); without one, through Windows (ADSI) as the account the portal runs under.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "ldapts";
import { adTlsCa, adUrls } from "./ad";

export type DirectoryUser = { username: string; name: string; email: string; ou: string };
type Row = { u: string; n: string; m: string; d: string };

// Enabled people only (bit 2 of userAccountControl = disabled).
const FILTER = "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))";

async function viaLdap(): Promise<Row[]> {
  let lastError: unknown;
  for (const url of adUrls()) {
    const client = new Client({ url, timeout: 30_000, connectTimeout: 10_000, tlsOptions: { ca: adTlsCa() } });
    try {
      await client.bind(process.env.AD_BIND_DN!, process.env.AD_BIND_PASSWORD ?? "");
      const { searchEntries } = await client.search(process.env.AD_BASE_DN ?? "", { scope: "sub", filter: FILTER, attributes: ["sAMAccountName", "displayName", "mail", "distinguishedName"], paged: { pageSize: 500 } });
      return searchEntries.map((e) => ({ u: String(e.sAMAccountName ?? ""), n: String(e.displayName ?? ""), m: String(e.mail ?? ""), d: String(e.distinguishedName ?? "") }));
    } catch (e) {
      lastError = e; // try the next domain controller
    } finally {
      await client.unbind().catch(() => {});
    }
  }
  throw new Error(`Could not read the EADECO user list: ${lastError instanceof Error ? lastError.message : lastError}`);
}

// Static script: nothing from the user goes into it.
const script = `
$s = [adsisearcher]'${FILTER}'
$s.PageSize = 1000
'sAMAccountName','displayName','mail','distinguishedName' | % { [void]$s.PropertiesToLoad.Add($_) }
$s.FindAll() | % { $p = $_.Properties; [pscustomobject]@{ u = "$($p.samaccountname)"; n = "$($p.displayname)"; m = "$($p.mail)"; d = "$($p.distinguishedname)" } } | ConvertTo-Json -Compress
`;

async function viaWindows(): Promise<Row[]> {
  const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  const rows = JSON.parse(stdout || "[]") as Row[];
  return Array.isArray(rows) ? rows : [rows];
}

const TTL = 10 * 60_000;
const cache = globalThis as unknown as { __directory?: { at: number; users: Promise<DirectoryUser[]> } };

async function load(): Promise<DirectoryUser[]> {
  const rows = process.env.AD_BIND_DN ? await viaLdap() : await viaWindows();
  return rows
    .filter((r) => r.u)
    .map((r) => ({
      username: r.u.toLowerCase(),
      name: r.n || r.u,
      email: r.m.toLowerCase(),
      ou: /OU=([^,]+)/.exec(r.d)?.[1] ?? "", // the nearest OU, e.g. EADEPRO
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function directoryUsers(): Promise<DirectoryUser[]> {
  if (!cache.__directory || Date.now() - cache.__directory.at > TTL) {
    const users = load();
    cache.__directory = { at: Date.now(), users };
    users.catch(() => (cache.__directory = undefined)); // a failure is not cached
  }
  return cache.__directory.users;
}
