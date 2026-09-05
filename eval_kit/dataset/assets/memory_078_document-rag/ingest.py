from pathlib import Path
from src.extract import html_to_text
from src.chunk import chunk_text

def ingest(path: Path, chunk_size: int=240):
    text = html_to_text(path.read_text(encoding='utf-8'))
    return [{'source': str(path), 'index': i, 'text': chunk} for i, chunk in enumerate(chunk_text(text, chunk_size))]
if __name__ == '__main__':
    import argparse, json
    p = argparse.ArgumentParser()
    p.add_argument('path', type=Path)
    args = p.parse_args()
    print(json.dumps(ingest(args.path), ensure_ascii=False, indent=2))
