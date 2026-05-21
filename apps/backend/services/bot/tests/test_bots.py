from fastapi.testclient import TestClient

from bot.main import app


def test_list_bots() -> None:
    client = TestClient(app)
    r = client.get("/v1/bots")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert {"id", "name", "status", "created_at"} <= set(data[0].keys())


def test_create_and_get_bot() -> None:
    client = TestClient(app)
    r = client.post("/v1/bots", json={"name": "测试 Bot"})
    assert r.status_code == 201
    bot = r.json()
    assert bot["name"] == "测试 Bot"
    assert bot["status"] == "draft"

    r2 = client.get(f"/v1/bots/{bot['id']}")
    assert r2.status_code == 200
    assert r2.json() == bot


def test_get_bot_not_found_returns_404() -> None:
    client = TestClient(app)
    r = client.get("/v1/bots/does-not-exist")
    assert r.status_code == 404
