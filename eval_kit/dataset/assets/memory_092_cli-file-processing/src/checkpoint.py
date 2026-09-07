from dataclasses import dataclass, asdict
import json
from pathlib import Path
from tempfile import NamedTemporaryFile

@dataclass(frozen=True)
class Checkpoint:
    completed: tuple[str, ...]
    failed: tuple[str, ...]

    def done(self, item_id: str) -> bool:
        return item_id in self.completed

    def with_success(self, item_id: str) -> 'Checkpoint':
        completed=tuple(dict.fromkeys((*self.completed,item_id)))
        failed=tuple(x for x in self.failed if x!=item_id)
        return Checkpoint(completed,failed)

    def with_failure(self, item_id: str) -> 'Checkpoint':
        if item_id in self.completed:return self
        return Checkpoint(self.completed,tuple(dict.fromkeys((*self.failed,item_id))))

def load_checkpoint(path: Path) -> Checkpoint:
    if not path.exists():return Checkpoint((),())
    data=json.loads(path.read_text(encoding='utf-8'))
    return Checkpoint(tuple(data.get('completed',[])),tuple(data.get('failed',[])))

def save_checkpoint(path: Path, checkpoint: Checkpoint) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    payload=json.dumps(asdict(checkpoint),indent=2,sort_keys=True)+'\n'
    with NamedTemporaryFile('w',encoding='utf-8',dir=path.parent,delete=False,prefix=f'.{path.name}.') as handle:
        handle.write(payload);handle.flush();temp=Path(handle.name)
    temp.replace(path)

def stable_item_id(path: Path, root: Path) -> str:
    try:relative=path.resolve().relative_to(root.resolve())
    except ValueError as exc:raise ValueError('path is outside root') from exc
    return relative.as_posix()

def pending_items(paths: list[Path], root: Path, checkpoint: Checkpoint) -> list[Path]:
    return [path for path in paths if not checkpoint.done(stable_item_id(path,root))]
