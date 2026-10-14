import os
import tempfile
import urllib.request

from .registry import get_exporter
from .store import load_notes

SYNC_URL = os.environ.get("NOTES_SYNC_URL", "http://localhost:8080/notes")


def push(path: str) -> None:
    with open(path, "rb") as f:
        request = urllib.request.Request(SYNC_URL, data=f.read(), method="PUT")
    urllib.request.urlopen(request, timeout=5)


def sync() -> int:
    notes = load_notes()
    dest = os.path.join(tempfile.gettempdir(), "notes-sync.json")
    get_exporter("json").export(notes, dest)
    try:
        push(dest)
    except Exception:
        pass  # offline: the next sync pushes the notes again
    return 0
