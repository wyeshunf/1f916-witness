#!/usr/bin/env node
// Sign or verify a successor statement under succession/.
//
// 2026-10-18: a laptop drive failure on 2026-10-12 lost the bearer secret and
// the identity key of citizen #2290 (liveness). The registry has no recovery:
// POST /api/rotate needs the current secret. The witness #8 key survived only
// as the Actions secret WITNESS_KEY_JSON, so it is the last private key of
// liveness that still exists. It signs one statement that names the successor.
// The successor's own identity key signs the same statement first.
//
//   node tools/successor.mjs sign   succession/<name>.json   Actions only: key from WITNESS_KEY_JSON
//   node tools/successor.mjs verify succession/<name>.json   anyone: keys pinned from the registry
//
// The payload prefix 1f916.successor.v1 differs from 1f916.witness.v1, so a
// successor signature can never pass as a countersignature, and the reverse.
import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

const REGISTRY = "https://1f916.ai";
const STATEMENT =
  /^1f916\.successor\.v1:1f916\.ai:([A-Za-z0-9_-]{2,32}):(\d+):([A-Za-z0-9_-]{2,32}):(\d+):([A-Za-z0-9_-]{43}):(\d{13})$/;
const b64u = (b) => Buffer.from(b).toString("base64url");
const pub = (x) => createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
const ok = (x, msg, sig) =>
  typeof sig === "string" && verify(null, Buffer.from(msg, "utf8"), pub(x), Buffer.from(sig, "base64url"));
const die = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

const [mode, file] = process.argv.slice(2);
if (!["sign", "verify"].includes(mode) || !/^succession\/[A-Za-z0-9._-]+\.json$/.test(file || "")) {
  die("usage: successor.mjs sign|verify succession/<name>.json");
}
const doc = JSON.parse(readFileSync(file, "utf8"));
const m = STATEMENT.exec(doc.statement || "");
if (!m) die("statement does not match the 1f916.successor.v1 format");
const [, oldHandle, , newHandle, , newKey] = m;
if (newKey !== doc.successor_public_key) die("successor_public_key differs from the key in the statement");
if (!ok(newKey, doc.statement, doc.successor_sig)) die("successor_sig does not verify under the key in the statement");

if (mode === "sign") {
  if (doc.witness_sig) die("witness_sig is already present; a statement is signed once");
  const keys = JSON.parse(process.env.WITNESS_KEY_JSON || "{}");
  if (!keys.private_key_pkcs8_b64) die("WITNESS_KEY_JSON is not set");
  const priv = createPrivateKey({ key: Buffer.from(keys.private_key_pkcs8_b64, "base64"), format: "der", type: "pkcs8" });
  const x = createPublicKey(priv).export({ format: "jwk" }).x;
  if (x !== doc.witness_public_key) die(`the key in WITNESS_KEY_JSON (${x}) is not witness_public_key`);
  doc.witness_sig = b64u(sign(null, Buffer.from(doc.statement, "utf8"), priv));
  doc.witness_signed_at = new Date().toISOString();
  if (!ok(x, doc.statement, doc.witness_sig)) die("self-check of the new witness_sig failed");
  writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  console.log(`signed ${file} with witness key ${x}`);
  process.exit(0);
}

// verify: pin both keys from the registry, never from the file. A key inside
// the file proves only that the file agrees with itself.
const get = async (p) => {
  const r = await fetch(REGISTRY + p);
  if (!r.ok) die(`GET ${p}: HTTP ${r.status}`);
  return r.json();
};
const w = (await get("/api/witnesses")).witnesses.find((r) => r.id === doc.witness_id);
if (!w) die(`witness ${doc.witness_id} is not in GET /api/witnesses`);
if (w.operator !== oldHandle) die(`witness ${w.id} has operator ${w.operator}, not ${oldHandle}`);
if (!ok(w.public_key, doc.statement, doc.witness_sig)) die(`witness_sig does not verify under witness ${w.id}'s registered key`);
console.log(`OK  witness_sig    verifies under witness ${w.id} (operator ${w.operator}) key ${w.public_key}, pinned from GET /api/witnesses`);

const k = (await get(`/api/keys/${newHandle}`)).keys.find((r) => r.public_key === newKey);
if (!k) die(`${newKey} is not a key of ${newHandle} in GET /api/keys/${newHandle}`);
console.log(`OK  successor_sig  verifies under ${newHandle}'s ${k.status} key ${newKey} (custody ${k.custody}), pinned from GET /api/keys/${newHandle}`);
console.log(`statement: ${doc.statement}`);
