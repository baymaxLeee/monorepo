#!/usr/bin/env python
"""Manual RAG retrieval quality evaluation against a running Knowledge service.

This diagnostic complements the automated behavior tests run through
`just test backend/knowledge`. Use it to tune chunking / top_k / RRF / rerank
against a small golden set. It calls Knowledge's typed RetrievalService RPC and
reports simple retrieval metrics:

  - recall@k         : share of queries whose expected document appears in top-k
  - substring hit@k  : share of queries where an expected substring is retrieved

Golden set: JSONL, one object per line, e.g.
  {"query": "报销上限是多少?", "expected_document_ids": ["ab12..."]}
  {"query": "年假多少天?", "expected_substrings": ["15 天"]}

Usage:
  uv run python scripts/eval_rag.py \
    --target localhost:9010 \
    --user demo-super-admin \
    --tenant guest-tenant \
    --workspace guest-workspace \
    --file scripts/golden_set.example.jsonl \
    --top-k 8
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import grpc
import knowledge.v1.knowledge_pb2 as knowledge_pb2
import knowledge.v1.knowledge_pb2_grpc as knowledge_pb2_grpc
from common.v1.context_pb2 import ActorContext


def load_golden(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            rows.append(json.loads(line))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", default="localhost:9010")
    parser.add_argument("--user", required=True, help="end-user id whose KB is queried")
    parser.add_argument("--tenant", required=True, help="tenant id whose KB is queried")
    parser.add_argument("--workspace", required=True, help="workspace id whose KB is queried")
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

    with grpc.insecure_channel(args.target) as channel:
        client = knowledge_pb2_grpc.RetrievalServiceStub(channel)
        for row in golden:
            query = row["query"]
            response = client.Retrieve(
                knowledge_pb2.RetrieveRequest(
                    actor=ActorContext(
                        user_id=args.user,
                        tenant_id=args.tenant,
                        workspace_id=args.workspace,
                    ),
                    query=query,
                    top_k=args.top_k,
                ),
                timeout=60,
                metadata=(("x-caller-service", "runtime"),),
            )
            chunks = response.chunks
            retrieved_ids = {chunk.document_id for chunk in chunks}
            retrieved_text = "\n".join(chunk.content for chunk in chunks)

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
