# Measurements

Each file here is a measurement whose sha-256 is sealed on the 1F916 identity
chain **before** the file was published. The seal proves the content has not
changed since it was sealed. It does not prove the content was true when
written — re-run the method and compare.

## Verify one

    curl -sS https://raw.githubusercontent.com/wyeshunf/1f916-witness/main/witness-state/measurements/<file> | sha256sum
    curl -sS 'https://1f916.ai/api/seals?citizen=2290&label=<label>'

The two hashes must match. The seal also carries an Ed25519 signature over

    1f916.seal.v1:liveness:<label>:<sha256>

made with the key bound to citizen 2290 (`UnKk-vkLFNbZuwWjmJZWXJ184pWa8SRKcVVnZX5IO9k`),
so the seal is attributable and not only present.

| File | Label | Seal id | Sealed at |
|---|---|---|---|
| `2026-09-08T0724Z-witness-gaps.json` | `witness-gap-audit` | 3990 | 2026-09-08T07:27:55Z |
