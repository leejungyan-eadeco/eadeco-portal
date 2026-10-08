// Checks a Windows (eadeco.local) username and password against Active Directory over LDAPS.
import { readFileSync } from "node:fs";
import { getCACertificates } from "node:tls";
import { Client, InvalidCredentialsError } from "ldapts";

// The domain controllers' certificates come from EADECO's internal CA, which Node's built-in list doesn't have:
// trust AD_TLS_CA (the CA certificate, e.g. ad-certificate.pem; needed in Docker) and the OS store (Windows has it
// via the domain). Certificates are still verified.
export function adTlsCa(): string[] {
  const file = process.env.AD_TLS_CA ? [readFileSync(process.env.AD_TLS_CA, "utf8")] : [];
  return [...file, ...getCACertificates("default"), ...getCACertificates("system")];
}

export const adUrls = () => (process.env.AD_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);

// A message that is safe to show on the login page.
export class LoginError extends Error {}

// RFC 4515: escape values placed inside an LDAP filter.
const escapeFilter = (v: string) => v.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`);

export type AdUser = { username: string; name: string; email: string };

// Who may use the portal is decided afterwards by the portal's own user list (src/lib/users.ts).
export async function adLogin(input: string, password: string): Promise<AdUser> {
  // Accept "leejungyan", "EADECO\leejungyan" or "leejungyan@eadeco.local".
  const sam = input.trim().replace(/^.*\\/, "").replace(/@.*$/, "");
  // An empty password would be an anonymous bind, which LDAP treats as success: never allow it.
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(sam) || !password) throw new LoginError("Enter your Windows username and password.");

  const urls = adUrls();
  const domain = process.env.AD_DOMAIN ?? "";
  const baseDN = process.env.AD_BASE_DN ?? "";
  if (!urls.length || !domain || !baseDN) throw new Error("AD_URLS, AD_DOMAIN and AD_BASE_DN must be set in .env.");

  let lastError: unknown;
  for (const url of urls) {
    const client = new Client({ url, timeout: 8_000, connectTimeout: 10_000, tlsOptions: { ca: adTlsCa() } });
    try {
      await client.bind(`${domain}\\${sam}`, password);
      const { searchEntries } = await client.search(baseDN, {
        scope: "sub",
        filter: `(sAMAccountName=${escapeFilter(sam)})`,
        attributes: ["sAMAccountName", "displayName", "mail"],
        sizeLimit: 1,
      });
      const e = searchEntries[0];
      const username = String(e?.sAMAccountName ?? sam).toLowerCase();
      return { username, name: String(e?.displayName || username), email: String(e?.mail ?? "") };
    } catch (e) {
      if (e instanceof InvalidCredentialsError) throw new LoginError("Wrong username or password.");
      if (e instanceof LoginError) throw e;
      lastError = e; // this domain controller is unreachable: try the next one
    } finally {
      await client.unbind().catch(() => {});
    }
  }
  throw new Error(`No domain controller answered: ${lastError instanceof Error ? lastError.message : lastError}`);
}
