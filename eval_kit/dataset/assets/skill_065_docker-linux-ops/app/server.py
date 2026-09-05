from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, signal, threading
ready = threading.Event()
ready.set()

class Handler(BaseHTTPRequestHandler):

    def do_GET(self):
        if self.path == '/health':
            self._json(200, {'status': 'ok'})
        elif self.path == '/ready':
            self._json(200 if ready.is_set() else 503, {'ready': ready.is_set()})
        else:
            self._json(404, {'error': 'not found'})

    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(fmt % args)

def run(port=8080):
    server = ThreadingHTTPServer(('0.0.0.0', port), Handler)

    def stop(*_):
        ready.clear()
        server.shutdown()
    signal.signal(signal.SIGTERM, stop)
    server.serve_forever()
if __name__ == '__main__':
    run()
