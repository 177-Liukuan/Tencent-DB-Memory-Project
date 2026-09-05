import os, json
from pathlib import Path

def load(path: Path | None, cli: dict):
    data = {}
    if path and path.exists():
        data.update(json.loads(path.read_text()))
    if os.getenv('BATCH_ROOT'):
        data['root'] = os.environ['BATCH_ROOT']
    data.update({k: v for k, v in cli.items() if v is not None})
    return data
