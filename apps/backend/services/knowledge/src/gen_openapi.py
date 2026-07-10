import json
import sys

from main import app

json.dump(app.openapi(), sys.stdout, indent=2, ensure_ascii=False)
