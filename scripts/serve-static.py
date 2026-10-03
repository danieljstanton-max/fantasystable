#!/usr/bin/env python3
"""Static server for the mockups directory.

Deliberately avoids `python3 -m http.server`: that module's __main__ block
evaluates os.getcwd() at import time, which is denied in sandboxed launch
environments and crashes before any argument is read. Constructing the
handler directly with an explicit directory never touches getcwd().

Usage:  serve.py [directory] [port]
"""

import errno
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_PORT = 8788


class NoCacheHandler(SimpleHTTPRequestHandler):
    """Serves with caching switched off.

    SimpleHTTPRequestHandler sends Last-Modified but no Cache-Control, so
    browsers fall back to heuristic caching and will happily serve a stale
    stylesheet without revalidating. On a design preview that reads as "my
    change didn't save", which costs more time than the requests do.
    """

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def resolve_directory(argv):
    if len(argv) > 1 and argv[1]:
        return argv[1]

    here = __file__
    if not os.path.isabs(here):
        sys.exit("serve.py: pass the directory to serve as the first argument")
    return os.path.join(os.path.dirname(os.path.dirname(here)), "mockups")


def main():
    directory = resolve_directory(sys.argv)
    port = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_PORT

    if not os.path.isdir(directory):
        sys.exit("serve.py: not a directory: %s" % directory)

    handler = partial(NoCacheHandler, directory=directory)

    try:
        server = ThreadingHTTPServer(("", port), handler)
    except OSError as err:
        if err.errno != errno.EADDRINUSE:
            raise
        # Almost always a server from an earlier session still running, which
        # is serving the same directory — say so instead of dumping a traceback.
        sys.exit(
            "serve.py: port %d is already in use — a server is probably "
            "already running.\n"
            "  Open it:  http://localhost:%d/review.html\n"
            "  Or stop it and retry:  pkill -f serve.py" % (port, port)
        )

    print("Serving %s on http://localhost:%d" % (directory, port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
