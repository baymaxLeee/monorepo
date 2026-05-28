"""Export OpenAPI spec to stdout.

Run via: `cd apps/backend && just gen-openapi chat`
Outputs `schemas/openapi/chat-server.json`.
"""

import json
import sys

from .main import app


def main() -> None:
    json.dump(app.openapi(), sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
