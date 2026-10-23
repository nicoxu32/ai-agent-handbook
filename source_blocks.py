"""Map complete rendered blocks back to safe Markdown insertion boundaries."""
import re
from bs4 import BeautifulSoup, Tag


def attach_source_blocks(source, soup, field_key, render_plain):
    roots = [node for node in soup.contents if isinstance(node, Tag)]
    signatures = [str(node) for node in roots]
    records = []
    boundaries = [match.start() for match in re.finditer(r'\n[ \t]*\n', source)] + [len(source)]
    mapped = set()
    for end in boundaries:
        prefix = BeautifulSoup(render_plain(source[:end]), 'html.parser')
        nodes = [node for node in prefix.contents if isinstance(node, Tag)]
        index = len(nodes) - 1
        if index < 0 or index in mapped or len(nodes) > len(roots):
            continue
        if [str(node) for node in nodes] != signatures[:len(nodes)]:
            continue
        root = roots[index]
        if not root.get_text().strip():
            continue
        mapped.add(index)
        root['data-append-index'] = str(len(records))
        root['data-append-key'] = field_key
        # Browser string offsets use UTF-16 code units, including for emoji.
        records.append({'end': len(source[:end].encode('utf-16-le')) // 2, 'text': root.get_text()})
    return records
