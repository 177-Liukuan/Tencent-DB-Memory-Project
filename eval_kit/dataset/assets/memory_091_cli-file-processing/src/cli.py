import argparse
def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    return p
