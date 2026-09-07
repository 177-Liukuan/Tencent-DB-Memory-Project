from html.parser import HTMLParser

class TextParser(HTMLParser):

    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        if data.strip():
            self.parts.append(data.strip())

def html_to_text(source: str) -> str:
    p = TextParser()
    p.feed(source)
    return '\n'.join(p.parts)
