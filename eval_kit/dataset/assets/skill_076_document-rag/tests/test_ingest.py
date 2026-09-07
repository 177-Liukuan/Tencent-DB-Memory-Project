from pathlib import Path
from ingest import ingest

def test_ingest_returns_chunks():
    chunks = ingest(Path('docs/incoming/scanned-spec.html'), 80)
    assert len(chunks) >= 2
    assert all((x['source'].endswith('scanned-spec.html') for x in chunks))
