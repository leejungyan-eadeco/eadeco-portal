// Checks a Windows (eadeco.local) username and password against Active Directory over LDAPS.
import { getCACertificates } from "node:tls";
import { Client, InvalidCredentialsError } from "ldapts";

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

  const urls = (process.env.AD_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  const domain = process.env.AD_DOMAIN ?? "";
  const baseDN = process.env.AD_BASE_DN ?? "";
  if (!urls.length || !domain || !baseDN) throw new Error("AD_URLS, AD_DOMAIN and AD_BASE_DN must be set in .env.");

  let lastError: unknown;
  for (const url of urls) {
    // The domain controllers' certificates come from EADECO's internal CA, which Windows trusts (via the domain)
    // but Node's built-in list doesn't: trust the Windows certificate store too. Certificates are still verified.
    const client = new Client({ url, timeout: 8_000, connectTimeout: 5_000, tlsOptions: { ca: [...getCACertificates("default"), ...getCACertificates("system")] } });
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
