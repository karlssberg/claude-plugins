from notes import exporters  # noqa: F401
from notes.registry import EXPORTERS, get_exporter


def test_builtin_formats_are_registered():
    assert {"json", "csv"} <= set(EXPORTERS)
    assert get_exporter("json") is not None
