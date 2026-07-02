#!/usr/bin/env python
"""Manual RAG retrieval quality check (NOT an automated test / NOT CI).

Demo phase forbids test scaffolding; this is a human-run diagnostic to tune
chunking / top_k / RRF / rerank against a small golden set. It calls the
knowledge `/internal/retrieve` endpoint and reports simple retrieval metrics:

  - recall@k         : share of queries whose expected document appears in top-k
  - substring hit@k  : share of queries where an expected substring is retrieved

Golden set: JSONL, one object per line, e.g.
  {"query": "报销上限是多少?", "expected_document_ids": ["ab12..."]}
  {"query": "年假多少天?", "expected_substrings": ["15 天"]}

Usage:
  uv run python scripts/eval_rag.py \
    --base-url http://localhost:8010 \
    --token dev-internal-token \
    --user demo-super-admin \
    --file scripts/golden_set.example.jsonl \
    --top-k 8
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import httpx


def load_golden(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            rows.append(json.loads(line))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8010")
    parser.add_argument("--token", default="dev-internal-token")
    parser.add_argument("--user", required=True, help="end-user id whose KB is queried")
    parser.add_argument("--file", required=True, help="golden set JSONL path")
    parser.add_argument("--top-k", type=int, default=8)
    args = parser.parse_args()

    golden = load_golden(Path(args.file))
    if not golden:
        print("golden set is empty", file=sys.stderr)
        return 2

    doc_hits = 0
    doc_total = 0
    sub_hits = 0
    sub_total = 0

    with httpx.Client(base_url=args.base_url.rstrip("/"), timeout=60.0) as client:
        for row in golden:
            query = row["query"]
            resp = client.post(
                "/internal/retrieve",
                headers={"X-Internal-Token": args.token},
                json={"user_id": args.user, "query": query, "top_k": args.top_k},
            )
            resp.raise_for_status()
            chunks = resp.json().get("chunks", [])
            retrieved_ids = {c["document_id"] for c in chunks}
            retrieved_text = "\n".join(c["content"] for c in chunks)

            expected_ids = row.get("expected_document_ids") or []
            if expected_ids:
                doc_total += 1
                if any(doc_id in retrieved_ids for doc_id in expected_ids):
                    doc_hits += 1

            expected_subs = row.get("expected_substrings") or []
            if expected_subs:
                sub_total += 1
                if any(sub in retrieved_text for sub in expected_subs):
                    sub_hits += 1

            status = "ok" if chunks else "EMPTY"
            print(f"[{status}] {query!r} -> {len(chunks)} chunks from {len(retrieved_ids)} docs")

    print("\n=== summary ===")
    if doc_total:
        print(f"recall@{args.top_k}       : {doc_hits}/{doc_total} = {doc_hits / doc_total:.2%}")
    if sub_total:
        print(f"substring hit@{args.top_k}: {sub_hits}/{sub_total} = {sub_hits / sub_total:.2%}")
    if not doc_total and not sub_total:
        print("(no expectations in golden set; ran retrieval only)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
