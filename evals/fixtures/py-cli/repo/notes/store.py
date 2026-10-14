import json
import os
from typing import List

STORE_PATH = os.environ.get("NOTES_STORE", os.path.expanduser("~/.notes.json"))


def load_notes() -> List[dict]:
    if not os.path.exists(STORE_PATH):
        return []
    with open(STORE_PATH, encoding="utf-8") as f:
        return json.load(f)
