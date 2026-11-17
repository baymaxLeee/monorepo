from main import create_app


def test_public_http_surface_has_no_legacy_internal_routes() -> None:
    paths = create_app().openapi()["paths"]

    assert not any(path.startswith("/internal") for path in paths)
