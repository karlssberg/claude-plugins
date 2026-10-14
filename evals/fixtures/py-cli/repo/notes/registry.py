"""The Exporter Seam: a registry of output formats, chosen by name."""
from typing import Callable, Dict, List, Protocol


class Exporter(Protocol):
    def export(self, notes: List[dict], dest: str) -> None:
        """Write the notes to dest."""


EXPORTERS: Dict[str, Callable[[], Exporter]] = {}


def register(name: str) -> Callable[[type], type]:
    def wrap(cls: type) -> type:
        EXPORTERS[name] = cls
        return cls
    return wrap


def get_exporter(name: str) -> Exporter:
    return EXPORTERS[name]()
