from pathlib import Path
def discover(root: Path) -> list[Path]:
    return sorted(root.rglob('*'))
