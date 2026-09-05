from pathlib import Path
from src.batch import plan_delete, execute

def test_plan_and_dry_run(tmp_path: Path):
    target = tmp_path / 'a.tmp'
    target.write_text('x')
    paths = plan_delete(tmp_path)
    assert paths == [target]
    summary = execute(paths, True)
    assert target.exists()
    assert summary.skipped == 1
