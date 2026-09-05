from dataclasses import dataclass
from pathlib import Path
from ingest import ingest
from src.metadata import inspect_source

@dataclass
class PipelineResult:
    source: str
    chunk_count: int
    total_chars: int

def run(path: Path, chunk_size: int=240) -> PipelineResult:
    chunks = ingest(path, chunk_size)
    inspect_source(path)
    return PipelineResult(source=str(path), chunk_count=len(chunks), total_chars=sum((len(x['text']) for x in chunks)))
