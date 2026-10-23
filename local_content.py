"""Local Markdown persistence, validation and explicit batch publishing."""
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from content_store import document_text, load_documents, read_document

LOCK = threading.RLock()


def run(root, args, timeout=60):
    result = subprocess.run(args, cwd=root, capture_output=True, text=True, timeout=timeout,
                            env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'})
    if result.returncode:
        raise ValueError('操作未完成：' + result.stderr.strip()[:700])
    return result.stdout.rstrip()


def build(root, output, content=None, static=False):
    args = [sys.executable, str(root / 'build.py'), '--output', str(output)]
    if content:
        args += ['--content-dir', str(content)]
    if static:
        args += ['--static']
    run(root, args)


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary.write(content)
        temporary.flush()
        os.fsync(temporary.fileno())
        name = temporary.name
    os.replace(name, path)


def current_html(root):
    with LOCK, tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / 'index.html'
        build(root, output)
        html = output.read_bytes()
        atomic_write(root / 'index.html', html)
        return html


def status(root):
    paths = run(root, ['git', 'diff', 'HEAD', '--name-only', '--', 'content/documents']).splitlines()
    untracked = run(root, ['git', 'ls-files', '--others', '--exclude-standard', 'content/documents']).splitlines()
    ahead = run(root, ['git', 'rev-list', '--count', 'origin/main..HEAD'])
    return {'pending': len(set(paths + untracked)), 'unpushed': int(ahead)}


def document(root, group):
    with LOCK:
        manifest, values, revisions = load_documents(root / 'content')
        if group not in manifest:
            raise ValueError('请选择有效的内容页面。')
        fields = manifest[group]['fields']
        return {'values': {f['key']: values[f['key']] for f in fields},
                'revision': revisions[group], 'path': f'content/documents/{group}.md'}


def save(root, body):
    if not isinstance(body, dict) or not isinstance(body.get('values'), dict):
        raise ValueError('保存内容格式不正确。')
    group = body.get('group')
    if not isinstance(group, str):
        raise ValueError('请选择内容页面。')
    with LOCK:
        manifest, values, revisions = load_documents(root / 'content')
        if group not in manifest:
            raise ValueError('未知内容页面。')
        if revisions[group] != body.get('revision'):
            raise ValueError('文件已被其他窗口或编辑器修改，尚未覆盖。请备份草稿并载入最新内容后合并。')
        entry = manifest[group]
        if set(body['values']) != {f['key'] for f in entry['fields']} or any(not isinstance(v, str) for v in body['values'].values()):
            raise ValueError('保存字段不完整。')
        if any(re.search(r'\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{15,}', v) for v in body['values'].values()):
            raise ValueError('正文中发现授权凭据，请删除后保存。')
        text = document_text(entry['title'], entry['fields'], body['values'])
        read_document(text, entry['fields'])
        path = root / 'content/documents' / (group + '.md')
        # Validate a temporary content tree before replacing the authoritative file.
        with tempfile.TemporaryDirectory() as directory:
            staging = Path(directory)
            shutil.copytree(root / 'content', staging / 'content')
            (staging / 'content/documents' / path.name).write_text(text)
            build(root, staging / 'index.html', staging / 'content')
            old = path.read_bytes()
            if hashlib.sha256(old).hexdigest() != revisions[group]:
                raise ValueError('验证期间文件被外部编辑器修改，尚未覆盖。请载入最新内容后合并。')
            backup_id = hashlib.sha256(old).hexdigest()[:16]
            atomic_write(root / '.local/backups' / f'{group}-{backup_id}.md', old)
            atomic_write(path, text.encode())
            atomic_write(root / 'index.html', (staging / 'index.html').read_bytes())
        return {'saved': True, 'revision': hashlib.sha256(text.encode()).hexdigest(), **status(root)}


def publish(root):
    with LOCK:
        if run(root, ['git', 'branch', '--show-current']) != 'main':
            raise ValueError('请切回 main 分支后发布。本地内容已保留。')
        if run(root, ['git', 'diff', '--cached', '--name-only']):
            raise ValueError('仓库有已暂存的其他修改，请先处理后发布。')
        changed = run(root, ['git', 'status', '--porcelain', '--untracked-files=all']).splitlines()
        if any(not line[3:].startswith('content/documents/') for line in changed):
            raise ValueError('仓库还有程序或结构修改，请先完成这些改动，再单独发布学习内容。')
        run(root, ['git', 'fetch', 'origin'], timeout=45)
        behind = int(run(root, ['git', 'rev-list', '--count', 'HEAD..origin/main']))
        ahead = int(run(root, ['git', 'rev-list', '--count', 'origin/main..HEAD']))
        if ahead:
            committed = run(root, ['git', 'diff', '--name-only', 'origin/main...HEAD']).splitlines()
            if any(not path.startswith('content/documents/') for path in committed):
                raise ValueError('本地有尚未发布的程序或结构提交，请先完成代码发布。')
        if behind and ahead:
            raise ValueError('远端与本地都有新提交，请先合并版本。本地修改已保留。')
        if behind:
            # Git refuses a fast-forward when it would overwrite local document edits.
            try:
                run(root, ['git', 'merge', '--ff-only', 'origin/main'])
            except ValueError:
                raise ValueError('远端更新涉及本地正在修改的文件，请先合并；没有覆盖本地内容。') from None
        with tempfile.TemporaryDirectory() as directory:
            build(root, Path(directory) / 'index.html', static=True)
        pending = status(root)['pending']
        if pending:
            run(root, ['git', 'add', '--', 'content/documents'])
            run(root, ['git', 'commit', '-m', 'Update locally edited handbook documents'])
        if status(root)['unpushed']:
            try:
                run(root, ['git', 'push', 'origin', 'main'], timeout=45)
            except ValueError:
                raise ValueError('发布尚未确认，修改和本地提交均已保留。请检查网络后再次点击发布；不会重复提交已保存内容。') from None
        return {'published': True, 'commit': run(root, ['git', 'rev-parse', 'HEAD']), **status(root)}
