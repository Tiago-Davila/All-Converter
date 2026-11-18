"""Permite arrancar el servidor con python -m convertitodo_mcp."""

import sys

from convertitodo_mcp.server.cli import main

if __name__ == "__main__":
    sys.exit(main())
