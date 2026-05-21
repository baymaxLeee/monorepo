from fastapi.testclient import TestClient


def test_list_bots(client: TestClient) -> None:
    r = client.get("/v1/bots")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert {"id", "name", "status", "created_at"} <= set(data[0].keys())


def test_create_and_get_bot(client: TestClient) -> None:
    r = client.post("/v1/bots", json={"name": "测试 Bot"})
    assert r.status_code == 201
    bot = r.json()
    assert bot["name"] == "测试 Bot"
    assert bot["status"] == "draft"

    r2 = client.get(f"/v1/bots/{bot['id']}")
    assert r2.status_code == 200
    assert r2.json() == bot


def test_get_bot_not_found_returns_404(client: TestClient) -> None:
    r = client.get("/v1/bots/does-not-exist")
    assert r.status_code == 404


def test_healthz_reports_dependencies(client: TestClient) -> None:
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["mysql"] == "up"
    assert body["redis"] == "up"
