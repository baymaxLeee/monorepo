from domain.chunking import chunk_text, estimate_tokens


def test_cjk_chunks_respect_the_token_budget() -> None:
    text = "。".join(["这是一个包含中文事实与实体名称的知识库段落"] * 40)

    chunks = chunk_text(text, max_tokens=32, overlap_tokens=8)

    assert len(chunks) > 1
    assert all(estimate_tokens(chunk) <= 32 for chunk in chunks)


def test_ascii_text_keeps_overlap_without_exceeding_the_budget() -> None:
    text = " ".join(f"word-{index}" for index in range(200))

    chunks = chunk_text(text, max_tokens=40, overlap_tokens=8)

    assert len(chunks) > 1
    assert all(estimate_tokens(chunk) <= 40 for chunk in chunks)
    assert chunks[0].split()[-1] in chunks[1]


def test_mixed_language_token_estimate_is_conservative_for_cjk() -> None:
    assert estimate_tokens("abcd") == 1
    assert estimate_tokens("知识库") == 3
    assert estimate_tokens("RAG知识") == 3
