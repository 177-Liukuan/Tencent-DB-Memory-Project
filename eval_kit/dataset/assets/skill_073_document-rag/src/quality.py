from dataclasses import dataclass
from statistics import mean

@dataclass(frozen=True)
class ChunkQuality:
    count: int
    minimum: int
    maximum: int
    average: float
    empty: int

@dataclass(frozen=True)
class DocumentQuality:
    headings: int
    tables: int
    links: int
    replacement_characters: int
    repeated_lines: int

def chunk_quality(chunks: list[str]) -> ChunkQuality:
    sizes=[len(chunk) for chunk in chunks]
    if not sizes:return ChunkQuality(0,0,0,0.0,0)
    return ChunkQuality(len(sizes),min(sizes),max(sizes),mean(sizes),sum(1 for size in sizes if size==0))

def document_quality(text: str) -> DocumentQuality:
    lines=[line.strip() for line in text.splitlines() if line.strip()]
    seen:dict[str,int]={}
    for line in lines:seen[line]=seen.get(line,0)+1
    return DocumentQuality(
        headings=sum(1 for line in lines if line.startswith('#')),
        tables=sum(1 for line in lines if '|' in line),
        links=text.count(']('),
        replacement_characters=text.count('\ufffd'),
        repeated_lines=sum(1 for count in seen.values() if count>=3),
    )

def recommend_actions(quality: DocumentQuality) -> list[str]:
    actions=[]
    if quality.replacement_characters:actions.append('retry with OCR or a different decoder')
    if quality.repeated_lines:actions.append('inspect reading order and repeated extraction')
    if quality.headings==0:actions.append('verify heading detection')
    return actions

def validate_chunk_coverage(source: str, chunks: list[str]) -> bool:
    normalized=' '.join(source.split())
    reconstructed=' '.join(' '.join(chunk.split()) for chunk in chunks)
    return reconstructed==normalized
