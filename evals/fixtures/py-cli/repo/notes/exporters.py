import csv
import json
from typing import List

from .registry import register


@register("json")
class JsonExporter:
    def export(self, notes: List[dict], dest: str) -> None:
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(notes, f, indent=2)


@register("csv")
class CsvExporter:
    def export(self, notes: List[dict], dest: str) -> None:
        with open(dest, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["id", "title", "body"])
            writer.writeheader()
            for note in notes:
                writer.writerow({k: note.get(k, "") for k in ("id", "title", "body")})
