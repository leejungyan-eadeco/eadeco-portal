// NAV gives no error codes, only an HTTP status and English text, so the portal sorts its answers into a
// fixed set of codes (like e-invoice does for LHDN). Each code says what to tell people, who fixes it,
// and whether trying again can help. The raw message is always kept for IT.
// Works on the stored message text, so runs recorded before the codes existed are sorted too.

export type ErrorCode = "NAV_UNREACHABLE" | "NAV_BUSY" | "NAV_SIGNIN" | "NAV_PERMISSION" | "NAV_SERVICE" | "INVOICE_DATA" | "PORTAL_ERROR";

type Info = { retry: boolean; title: string; action: string; owner: string };

export const errorInfo: Record<ErrorCode, Info> = {
  NAV_UNREACHABLE: { retry: true, title: "Couldn't reach NAV", action: "Nothing to do. The portal tries again on its next run. If it keeps happening, tell IT.", owner: "No one" },
  NAV_BUSY: { retry: true, title: "NAV was busy", action: "Nothing to do. The portal tries again on its next run.", owner: "No one" },
  NAV_SIGNIN: { retry: false, title: "NAV refused the portal's sign-in", action: "Tell IT: the portal's NAV account or password needs checking.", owner: "IT" },
  NAV_PERMISSION: { retry: false, title: "The portal's NAV account isn't allowed to do this", action: "Tell IT: the NAV account needs permission in this company.", owner: "IT" },
  NAV_SERVICE: { retry: false, title: "A NAV web service is missing or renamed", action: "Tell IT: check Settings > NAV connection.", owner: "IT" },
  INVOICE_DATA: {
    retry: false,
    title: "NAV didn't accept this invoice",
    action: "Edit the recurring invoice and fix what NAV mentions. The portal tries again after you save it.",
    owner: "Whoever looks after this recurring invoice",
  },
  PORTAL_ERROR: { retry: true, title: "Something unexpected went wrong", action: "The portal tries again on its next run. If it keeps happening, tell IT.", owner: "IT" },
};

// Order matters: the most specific causes first.
const rules: [ErrorCode, RegExp][] = [
  ["NAV_SIGNIN", /logon attempt failed|refused the NAV sign-in|HTTP 401|answered 401|InvalidCredentials|rejected the client credentials/i],
  ["NAV_PERMISSION", /HTTP 403|answered 403|do not have the following permissions|not have permission/i],
  ["NAV_BUSY", /locked|another user has modified|deadlock/i],
  ["INVOICE_DATA", /does not exist|is not an option|must have a value|is blocked|blocked for|cannot be|must be (greater|less|positive)|there is no .* within the filter|already exists|exceeds/i],
  ["NAV_SERVICE", /HTTP 404|answered 404|NotFound|is not published/i],
  ["NAV_UNREACHABLE", /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|UND_ERR|timed? ?out|HTTP 50[234]|answered 50[234]|An error has occurred\.?"?$/i],
];

export const classify = (raw: string): ErrorCode => rules.find(([, re]) => re.test(raw))?.[0] ?? "PORTAL_ERROR";

// NAV's own words, without the "NAV refused the request to ... (HTTP 400): " prefix.
const navWords = (raw: string) => raw.replace(/^NAV (refused the request to|answered) [^:]*?(\(HTTP \d+\))?: /, "").trim();

// Everything a person needs, from the stored code (or the raw text for older runs).
export function explain(raw: string, code?: string | null) {
  const c = (code && code in errorInfo ? code : classify(raw)) as ErrorCode;
  const info = errorInfo[c];
  return { code: c, ...info, summary: c === "INVOICE_DATA" ? `${info.title}: ${navWords(raw)}` : info.title };
}
