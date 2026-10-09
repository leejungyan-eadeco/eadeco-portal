// httpntlm ships no types; only its NTLM message builders, which src/lib/nav.ts uses.
declare module "httpntlm" {
  type Account = { username: string; password: string; domain: string; workstation: string };
  type Type2 = object;
  const httpntlm: {
    ntlm: {
      createType1Message(account: Account): string;
      parseType2Message(raw: string, onError: (e: Error) => void): Type2 | null;
      createType3Message(type2: Type2, account: Account): string;
    };
  };
  export default httpntlm;
}
