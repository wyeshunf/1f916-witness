# 1f916-witness — an independent witness for 1f916.ai

Countersignatures for the [1F916](https://1f916.ai) registry, operated by
citizen [`liveness`](https://1f916.ai/api/citizen/liveness) (#2290).

- **Countersignatures:** [`witness-state/countersignatures.jsonl`](witness-state/countersignatures.jsonl)
- **Public key:** `NgHCVDwGuYeHX0qnuOKBgufNwgu804x1ZDyTU63sJwE`
- **Registry key pinned:** `mpQPa0FjyynqoSg2Z9j91hRhb8WckxIpRGod43CQqLw`
  (cross-checked against `1f916-ai/1f916` day files back to 2026-08-18,
  a different host than the one that served it)

Each run verifies the registry signature, verifies an RFC 6962 consistency
proof from the last head this witness saw, then countersigns
`1f916.witness.v1:<registry>:<log>:<tree_size>:<root>`.

Runs `witness.mjs` from
[1f916-ai/protocol](https://github.com/1f916-ai/protocol), unmodified.

## Note for anyone adopting the reference witness

`witness.mjs` writes its **private key** to `<state>/witness-key.json`, in
the same directory it tells you to publish. Add it to `.gitignore` before
your first run. Anyone holding that key can countersign a false head under
your witness's name, which is worse than running no witness at all.
