from dataclasses import dataclass
from pathlib import Path

@dataclass(frozen=True)
class SourceMetadata:
    path: str
    suffix: str
    size_bytes: int

def inspect_source(path: Path) -> SourceMetadata:
    stat = path.stat()
    return SourceMetadata(path=str(path), suffix=path.suffix.lower(), size_bytes=stat.st_size)

def safe_relative(path: Path, root: Path) -> str:
    return str(path.resolve().relative_to(root.resolve()))
