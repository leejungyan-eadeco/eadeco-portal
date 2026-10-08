// Self-check for secret.ts: node --no-warnings src/lib/secret.check.ts (part of pnpm check)
import assert from "node:assert";
import { randomBytes } from "node:crypto";
import { seal, unseal } from "./secret.ts";

process.env.CREDENTIALS_KEY = randomBytes(32).toString("base64");
const s = seal("p@ss wörd");
assert.equal(unseal(s), "p@ss wörd");
assert.notEqual(seal("x"), seal("x")); // fresh IV each time
const parts = s.split(".");
parts[3] = Buffer.from("tampered").toString("base64");
assert.throws(() => unseal(parts.join(".")), /can't be read/);
process.env.CREDENTIALS_KEY = randomBytes(32).toString("base64");
assert.throws(() => unseal(s), /can't be read/); // another key
console.log("secret ok");
