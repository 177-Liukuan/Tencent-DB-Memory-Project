from dataclasses import dataclass
from pathlib import Path

@dataclass
class Summary:
    success: int = 0
    skipped: int = 0
    failed: int = 0

def plan_delete(root: Path, suffix='.tmp'):
    return sorted((p for p in root.rglob(f'*{suffix}') if p.is_file()))

def execute(paths: list[Path], dry_run=True):
    s = Summary()
    for path in paths:
        try:
            if dry_run:
                s.skipped += 1
            else:
                path.unlink()
                s.success += 1
        except OSError:
            s.failed += 1
    return s
