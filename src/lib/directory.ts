// The EADECO user list, for picking people to invite. Read through Windows (ADSI) as the account the portal
// runs under, so no directory password is stored. Windows-only, like the NAV sign-in.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type DirectoryUser = { username: string; name: string; email: string; ou: string };

// Enabled people only (bit 2 of userAccountControl = disabled). Static script: nothing from the user goes into it.
const script = `
$s = [adsisearcher]'(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))'
$s.PageSize = 1000
'sAMAccountName','displayName','mail','distinguishedName' | % { [void]$s.PropertiesToLoad.Add($_) }
$s.FindAll() | % { $p = $_.Properties; [pscustomobject]@{ u = "$($p.samaccountname)"; n = "$($p.displayname)"; m = "$($p.mail)"; d = "$($p.distinguishedname)" } } | ConvertTo-Json -Compress
`;

const TTL = 10 * 60_000;
const cache = globalThis as unknown as { __directory?: { at: number; users: Promise<DirectoryUser[]> } };

async function load(): Promise<DirectoryUser[]> {
  const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  const rows = JSON.parse(stdout || "[]") as { u: string; n: string; m: string; d: string }[];
  return (Array.isArray(rows) ? rows : [rows])
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
