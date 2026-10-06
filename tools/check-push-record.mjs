#!/usr/bin/env node
// Check countersignature rows against GitHub's own record of the pushes.
//
// Why this exists
// ---------------
// Two fields of every row are this witness's word only. `runner` is stamped
// after signing (tools/stamp-runner.py), and `at` is this host's clock.
// Neither is inside `witness_sig`, which covers
// `1f916.witness.v1:<registry>:<log>:<tree_size>:<root>`.
//
// GitHub keeps a record that this witness does not write. For every push to
// main, GET /repos/{owner}/{repo}/activity gives the time GitHub received it
// and the account whose credential pushed it. The local runner pushes with
// the operator's user credential. The Actions runner pushes with the token
// that GitHub creates for each workflow job, so its pushes show as
// `github-actions[bot]`.
//
// This script maps each row to the commit that appended it, and each commit
// to the push that delivered it. Then it checks:
//   1. for each runner-stamped publish, the push actor agrees with `runner`;
//   2. for every row, `at` is not later than the time GitHub received the push;
//   3. for every identity_events row, `at` is not earlier than `created_at`, which is
//      the registry's clock inside its signed checkpoint payload
//      `1f916.checkpoint.v1:<log>:<tree_size>:<root>:<created_at>`.
// It also checks the Actions run list from the other side: each successful
// run should hold exactly one bot push, and no bot push should fall outside
// a run. For rows without `runner` (rows 1-2218) it prints the push actor.
//
// What it cannot show: both credentials belong to one operator. The actor
// says which credential pushed, not what code ran. If the operator put the
// user credential into the Actions secrets, an Actions push would look local
// and this check would not see it. The record lives in GitHub's API, not in
// this file, so a copy of the file does not carry it.
//
// Usage, from the root of a full (not shallow) clone:
//   node tools/check-push-record.mjs [lastRow]
// lastRow limits the check to rows 1..lastRow (the file only appends, so a
// result for a fixed lastRow does not change). Set GITHUB_TOKEN for a higher
// rate limit. Without it GitHub allows 60 requests per hour, and the run
// needs about 33 (October 2026).
// Exit 0: no row failed. Exit 1: a row failed a check. Exit 2: no result.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SLUG = process.env.WITNESS_REPO || "wyeshunf/1f916-witness";
const FILE = "witness-state/countersignatures.jsonl";
const ACTOR = { local: "wyeshunf", "github-actions": "github-actions[bot]" };
const lastRow = process.argv[2] ? Number(process.argv[2]) : Infinity;

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });
const die = (msg) => { console.error(msg); process.exit(2); };

async function pages(url) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "1f916-witness-check" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const out = [];
  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) die(`GET ${url} -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    out.push(...(Array.isArray(body) ? body : body.workflow_runs));
    url = (res.headers.get("link") || "").match(/<([^>]+)>;\s*rel="next"/)?.[1];
  }
  return out;
}

if (git("rev-parse", "--is-shallow-repository").trim() === "true") die("shallow clone: run git fetch --unshallow");

// 1. Row number -> the commit that appended it.
const rows = readFileSync(FILE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const rowCommit = [];
let commit = null, deletedLines = 0;
for (const line of git("log", "--reverse", "--format=C %H", "--numstat", "--", FILE).split("\n")) {
  if (line.startsWith("C ")) { commit = line.slice(2); continue; }
  const m = line.match(/^(\d+)\t(\d+)\t/);
  if (!m) continue;
  deletedLines += Number(m[2]);
  for (let i = 0; i < Number(m[1]); i++) rowCommit.push(commit);
}

// 2. Commit -> the push that delivered it (GitHub's time and actor).
const activity = await pages(`https://api.github.com/repos/${SLUG}/activity?per_page=100`);
const push = new Map();
const kinds = {};
let notLocal = 0;
for (const a of activity) {
  if (a.ref !== "refs/heads/main") continue;
  kinds[a.activity_type] = (kinds[a.activity_type] || 0) + 1;
  const range = /^0+$/.test(a.before) ? a.after : `${a.before}..${a.after}`;
  let list;
  try { list = git("rev-list", range).split("\n").filter(Boolean); } catch { notLocal++; continue; }
  for (const c of list) if (!push.has(c)) push.set(c, { t: Date.parse(a.timestamp), actor: a.actor?.login });
}

// 3. The Actions run list.
const runs = (await pages(`https://api.github.com/repos/${SLUG}/actions/runs?per_page=100`))
  .map((r) => ({ id: r.id, ok: r.conclusion === "success", c: Date.parse(r.created_at), u: Date.parse(r.updated_at) }));

// 4. Group rows into publishes (one commit each) and check them.
const pubs = new Map();
rows.forEach((r, i) => {
  if (i + 1 > lastRow) return;
  const c = rowCommit[i] || "uncommitted";
  if (!pubs.has(c)) pubs.set(c, { first: i + 1, rows: [] });
  pubs.get(c).rows.push(r);
});

const fail = [];
const res = { rows_checked: Math.min(rows.length, lastRow), deleted_lines: deletedLines, pushes: kinds, pushes_not_in_clone: notLocal,
  stamped_publishes: 0, actor_agrees: 0, unstamped_publishes_by_actor: {}, not_pushed_yet: 0, lag_s: null, checkpoint_lead_s: null };
const lag = [], lead = [];
for (const [c, p] of pubs) {
  const ps = push.get(c);
  if (!ps) { res.not_pushed_yet++; continue; }
  // The time checks apply to every row, stamped or not.
  const at = Math.max(...p.rows.map((r) => Date.parse(r.at)));
  lag.push((ps.t - at) / 1000);
  // GitHub's timestamp has whole seconds; allow for the truncation.
  if (ps.t + 1000 < at) fail.push({ row: p.first, check: "at is later than the push", at: p.rows[0].at, push: new Date(ps.t).toISOString() });
  for (const r of p.rows) {
    if (r.log !== "identity_events") continue;
    lead.push((Date.parse(r.at) - r.created_at) / 1000);
    if (Date.parse(r.at) < r.created_at) fail.push({ row: p.first, check: "at is earlier than created_at", at: r.at, created_at: r.created_at });
  }
  // The actor check applies to rows that carry `runner` (row 2219 onward).
  const labels = new Set(p.rows.map((r) => r.runner));
  if (labels.has(undefined)) {
    if (labels.size > 1) fail.push({ row: p.first, check: "stamped and unstamped rows in one commit" });
    res.unstamped_publishes_by_actor[ps.actor] = (res.unstamped_publishes_by_actor[ps.actor] || 0) + 1;
    continue;
  }
  res.stamped_publishes++;
  if (labels.size === 1 && ACTOR[[...labels][0]] === ps.actor) res.actor_agrees++;
  else fail.push({ row: p.first, check: "push actor disagrees with runner", runner: [...labels], actor: ps.actor });
}

// The run check uses every bot push in the activity log, so its counts grow
// with time and do not depend on lastRow.
const botPush = activity.filter((a) => a.ref === "refs/heads/main" && a.actor?.login === "github-actions[bot]").map((a) => Date.parse(a.timestamp));
const inRun = (t) => runs.filter((r) => r.c <= t && t <= r.u + 2000);
const okRuns = runs.filter((r) => r.ok);
res.actions_runs = { success: okRuns.length, other: runs.length - okRuns.length,
  success_with_one_bot_push: okRuns.filter((r) => botPush.filter((t) => r.c <= t && t <= r.u + 2000).length === 1).length,
  bot_pushes_outside_a_run: botPush.filter((t) => inRun(t).length === 0).length };
const q = (v) => { const s = [...v].sort((a, b) => a - b); return { min: s[0], median: s[s.length >> 1], max: s[s.length - 1] }; };
if (lag.length) res.lag_s = q(lag);
if (lead.length) res.checkpoint_lead_s = q(lead);
if (deletedLines) fail.push({ check: "the file lost lines", deleted_lines: deletedLines });
res.failures = fail.length;
console.log(JSON.stringify(res, null, 1));
if (fail.length) { console.log(JSON.stringify(fail.slice(0, 20), null, 1)); process.exit(1); }
