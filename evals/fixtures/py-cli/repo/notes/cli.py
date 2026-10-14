import argparse
import os
import sys

from . import exporters  # noqa: F401  registers the built-in formats
from .registry import get_exporter
from .store import load_notes
from .sync import sync


def cmd_export(args: argparse.Namespace) -> int:
    exporter = get_exporter(args.format)
    exporter.export(load_notes(), args.out)
    return 0


def cmd_sync(args: argparse.Namespace) -> int:
    return sync()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="notes")
    commands = parser.add_subparsers(dest="command", required=True)

    export = commands.add_parser("export", help="write every note to a file")
    export.add_argument("--format", default=os.environ.get("NOTES_FORMAT", "json"))
    export.add_argument("out")
    export.set_defaults(handler=cmd_export)

    sync_cmd = commands.add_parser("sync", help="push the notes to the sync server")
    sync_cmd.set_defaults(handler=cmd_sync)

    args = parser.parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
