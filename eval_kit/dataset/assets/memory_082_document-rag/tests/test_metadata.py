from pathlib import Path
from src.metadata import inspect_source

def test_inspect_source(tmp_path: Path):
    p = tmp_path / 'sample.html'
    p.write_text('<p>hello</p>', encoding='utf-8')
    meta = inspect_source(p)
    assert meta.suffix == '.html'
    assert meta.size_bytes > 0
