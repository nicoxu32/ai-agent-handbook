"""Read and write editable Markdown documents without a database."""
import hashlib
import json
import re

FIELD = re.compile(r'<!-- field:([a-zA-Z0-9/_.-]+) -->\n(.*?)\n<!-- /field -->', re.S)


def document_text(title, fields, values):
    sections = ['# ' + title]
    for field in fields:
        value = values[field['key']]
        if '<!-- field:' in value or '<!-- /field' in value:
            raise ValueError('正文不能包含文档字段分隔标记。')
        sections.append(f"## {field['label']}\n\n<!-- field:{field['key']} -->\n{value}\n<!-- /field -->")
    return '\n\n'.join(sections) + '\n'


def read_document(text, fields):
    matches = FIELD.findall(text)
    values = dict(matches)
    if len(matches) != len(values) or set(values) != {field['key'] for field in fields}:
        raise ValueError('Markdown 文件的内容分区不完整，请保留字段标记。')
    for field in fields:
        value = values[field['key']]
        if not value.strip() or len(value) > (40000 if field['multiline'] else 300):
            raise ValueError(f"「{field['label']}」为空或过长。")
        if not field['multiline'] and '\n' in value:
            raise ValueError(f"「{field['label']}」不能包含换行。")
        if '<!-- field:' in value or '<!-- /field' in value:
            raise ValueError('正文中包含无效字段标记。')
    return values


def load_documents(content):
    manifest_path = content / 'documents.json'
    if not manifest_path.exists():
        return {}, {}, {}
    manifest = json.loads(manifest_path.read_text())
    values, revisions = {}, {}
    for group, entry in manifest.items():
        if not re.fullmatch(r'[a-zA-Z0-9_-]+', group):
            raise ValueError('Invalid document group')
        raw = (content / 'documents' / (group + '.md')).read_bytes()
        values.update(read_document(raw.decode('utf-8'), entry['fields']))
        revisions[group] = hashlib.sha256(raw).hexdigest()
    return manifest, values, revisions


def add_documents(content, groups):
    """Create documents for a migration or newly imported questions."""
    path = content / 'documents.json'
    manifest = json.loads(path.read_text()) if path.exists() else {}
    (content / 'documents').mkdir(exist_ok=True)
    for group, title, fields, values in groups:
        if group in manifest:
            raise ValueError('Document already exists: ' + group)
        manifest[group] = {'title': title, 'fields': [{k: field[k] for k in ['key', 'label', 'multiline']} for field in fields]}
        text = document_text(title, fields, values)
        read_document(text, fields)
        (content / 'documents' / (group + '.md')).write_text(text)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
