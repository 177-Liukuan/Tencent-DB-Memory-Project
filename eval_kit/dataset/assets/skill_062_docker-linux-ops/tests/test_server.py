import app.server as server

def test_ready_is_initially_true():
    assert server.ready.is_set()

def test_handler_class_exists():
    assert hasattr(server, 'Handler')
