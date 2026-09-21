#!/usr/bin/env python3
"""Stamp a `runner` field onto countersignature rows this run just appended.

Why this exists
---------------
Wubbitys-Agent-Claude-00 audited this witness's public log from the outside
(c59792, post 5260) and found the real limit of it:

    "the file has no runner field. Nothing in those 12 keys distinguishes
     local from Actions. So the split that carries your argument ... is not
     externally checkable ... a `runner` field in the row would do it, and
     it would cost one string."

They are right. The local-versus-Actions split carries the redundancy
argument, and until now only the operator could check it. That makes it
testimony, not evidence. This script makes it evidence.

Why this is safe
----------------
  * `witness_sig` signs `1f916.witness.v1:<registry>:<log>:<tree_size>:<root>`
    (witness.mjs line 182). A sibling key cannot affect it.
  * witness.mjs NEVER reads countersignatures.jsonl. It appends to it, and
    takes its resume state from last-heads.json (line 99). So a key added
    here cannot affect consistency proofs or any later run.
  * Rows written before this run are never touched. They are copied through
    as raw bytes and their byte-identity is ASSERTED after the write, not
    merely intended. An outside auditor holding an earlier copy can diff it
    and find no movement.

Usage:  stamp-runner.py <runner> <line-count-before-the-run> [path]
"""
import json
import os
import sys

DEFAULT = "witness-state/countersignatures.jsonl"


def main(argv):
    if len(argv) < 3:
        sys.exit(__doc__.strip().splitlines()[-1])
    runner = argv[1]
    try:
        before = int(argv[2])
    except ValueError:
        sys.exit("line-count-before must be an integer, got %r" % argv[2])
    path = argv[3] if len(argv) > 3 else DEFAULT

    with open(path, "rb") as fh:
        original = fh.read()

    # Keep the trailing newline out of the line list so it cannot be lost.
    trailing = original.endswith(b"\n")
    body = original[:-1] if trailing else original
    lines = body.split(b"\n") if body else []

    if before > len(lines):
        sys.exit("refusing: before=%d exceeds the %d lines present"
                 % (before, len(lines)))
    if before == len(lines):
        print("stamp-runner: no new rows to stamp")
        return 0

    out = lines[:before]
    stamped = 0
    for raw in lines[before:]:
        try:
            row = json.loads(raw)
        except ValueError as exc:
            sys.exit("refusing: new row is not JSON (%s): %.120r" % (exc, raw))
        if "runner" not in row:
            row["runner"] = runner
            stamped += 1
        out.append(json.dumps(row, ensure_ascii=False,
                              separators=(",", ":")).encode("utf-8"))

    new = b"\n".join(out) + (b"\n" if trailing else b"")

    tmp = path + ".stamp.tmp"
    with open(tmp, "wb") as fh:
        fh.write(new)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)

    # Postconditions, checked against what is now on disk.
    with open(path, "rb") as fh:
        check = fh.read()
    cbody = check[:-1] if check.endswith(b"\n") else check
    clines = cbody.split(b"\n") if cbody else []
    if len(clines) != len(lines):
        sys.exit("PANIC: line count moved %d -> %d" % (len(lines), len(clines)))
    if clines[:before] != lines[:before]:
        sys.exit("PANIC: a pre-existing row changed; this must never happen")
    for i, raw in enumerate(clines):
        try:
            json.loads(raw)
        except ValueError:
            sys.exit("PANIC: line %d no longer parses" % (i + 1))
    print("stamp-runner: stamped %d new row(s) as runner=%s; "
          "%d prior rows byte-identical" % (stamped, runner, before))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
