#!/bin/bash
# RetroClip - Local Development Server
# Serves files with headers needed for FFmpeg.wasm (SharedArrayBuffer)

PORT=${1:-8080}

echo ""
echo "  RetroClip Video Editor"
echo "  ────────────────────────────────────"
echo "  Open http://localhost:$PORT in your browser"
echo "  Press Ctrl+C to stop"
echo ""

# Try Python first, fall back to Ruby
if command -v python3 &>/dev/null && python3 -c "pass" 2>/dev/null; then
  python3 -c "
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

class CORSHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        super().end_headers()

try:
    HTTPServer(('localhost', $PORT), CORSHandler).serve_forever()
except KeyboardInterrupt:
    sys.exit(0)
"
elif command -v ruby &>/dev/null; then
  ruby -e "
require 'webrick'
server = WEBrick::HTTPServer.new(Port: $PORT, DocumentRoot: '.', Logger: WEBrick::Log.new('/dev/null'), AccessLog: [])
trap('INT') { server.shutdown }
server.start
"
else
  echo "Error: No suitable server runtime found. Install Python 3 or use Ruby."
  exit 1
fi
