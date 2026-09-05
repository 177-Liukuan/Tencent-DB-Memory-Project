def chunk_text(text: str, max_chars: int):
    if max_chars <= 0:
        raise ValueError('max_chars must be positive')
    words = text.split()
    chunks = []
    current = []
    size = 0
    for word in words:
        extra = len(word) + (1 if current else 0)
        if current and size + extra > max_chars:
            chunks.append(' '.join(current))
            current = [word]
            size = len(word)
        else:
            current.append(word)
            size += extra
    if current:
        chunks.append(' '.join(current))
    return chunks
