import argparse
from pathlib import Path
from src.batch import plan_delete, execute

def parser():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='command', required=True)
    clean = sub.add_parser('clean')
    clean.add_argument('root', type=Path)
    clean.add_argument('--apply', action='store_true')
    return p

def main(argv=None):
    args = parser().parse_args(argv)
    paths = plan_delete(args.root)
    summary = execute(paths, dry_run=not args.apply)
    print(f'success={summary.success} skipped={summary.skipped} failed={summary.failed}')
    return 1 if summary.failed else 0
if __name__ == '__main__':
    raise SystemExit(main())
