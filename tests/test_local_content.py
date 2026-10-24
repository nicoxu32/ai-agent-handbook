"""Verify local disk persistence and publishing against a temporary Git remote."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from bs4 import BeautifulSoup
import local_content
from content_store import load_documents, document_text, add_documents

ROOT = Path(__file__).resolve().parents[1]


def copy_project(target):
    for pattern in ['*.py', '*.js', '*.css', 'template.html', 'architecture.json', '.gitignore']:
        for path in ROOT.glob(pattern):
            shutil.copyfile(path, target / path.name)
    shutil.copytree(ROOT / 'content', target / 'content')


def git(root, *args):
    return local_content.run(root, ['git', *args])


class LocalContentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        copy_project(self.root)
        git(self.root, 'init', '-b', 'main')
        git(self.root, 'config', 'user.email', 'test@example.invalid')
        git(self.root, 'config', 'user.name', 'Test')
        git(self.root, 'add', '.')
        git(self.root, 'commit', '-m', 'Initial fixture')
        self.remote = Path(self.temp.name) / 'remote.git'
        git(self.root, 'init', '--bare', str(self.remote))
        git(self.root, 'remote', 'add', 'origin', str(self.remote))
        git(self.root, 'push', '-u', 'origin', 'main')

    def tearDown(self):
        self.temp.cleanup()

    def test_open_document_uses_registered_file_without_writing(self):
        path = self.root / 'content/documents/k01.md'
        before = path.read_bytes()
        with patch('local_content.run') as launch, patch('local_content.sys.platform', 'darwin'):
            result = local_content.open_document(self.root, 'k01')
            self.assertTrue(result['opened'])
            launch.assert_called_once_with(self.root, ['open', '-t', str(path.resolve())], timeout=10)
            launch.reset_mock()
            for invalid in ['../../.env', 'missing', None, ['k01']]:
                with self.assertRaises(ValueError):
                    local_content.open_document(self.root, invalid)
            launch.assert_not_called()
            self.assertEqual(before, path.read_bytes())
            path.unlink()
            path.symlink_to(self.root / 'README.md')
            with self.assertRaises(ValueError):
                local_content.open_document(self.root, 'k01')
            launch.assert_not_called()

    def test_save_is_local_immediate_and_preserves_backups(self):
        before = git(self.root, 'rev-parse', 'HEAD')
        doc = local_content.document(self.root, 'k01')
        old = (self.root / doc['path']).read_bytes()
        doc['values']['chapter/k01/intro'] = '**本地新增**\n下一行 😀。\n\n第二段。'
        result = local_content.save(self.root, {'group': 'k01', **doc})
        self.assertEqual(result['pending'], 1)
        self.assertEqual(before, git(self.root, 'rev-parse', 'HEAD'))
        self.assertEqual(before, git(self.root, 'rev-parse', 'origin/main'))
        self.assertEqual(next((self.root / '.local/backups').glob('k01-*.md')).read_bytes(), old)
        html = local_content.current_html(self.root).decode()
        data = json.loads(BeautifulSoup(html, 'html.parser').select_one('#handbook-data').string)
        self.assertIn('本地新增', data['chapters'][0]['intro'])
        self.assertIn('<br/>', data['chapters'][0]['intro'])
        self.assertIn('本地新增', data['chapters'][0]['search'])
        self.assertIn('本地新增', data['source'])
        self.assertEqual(len(data['chapters']), 36)
        self.assertEqual(sum(len(c['questions']) for c in data['chapters']), 108)
        with self.assertRaisesRegex(ValueError, '其他窗口'):
            local_content.save(self.root, {'group': 'k01', **doc})

    def test_validation_failure_does_not_replace_file(self):
        doc = local_content.document(self.root, 'k01')
        before = (self.root / doc['path']).read_bytes()
        doc['values']['chapter/k01/intro'] = '测试草稿。'
        with patch('local_content.build', side_effect=ValueError('Invalid build')):
            with self.assertRaises(ValueError):
                local_content.save(self.root, {'group': 'k01', **doc})
        self.assertEqual((self.root / doc['path']).read_bytes(), before)
        for value in ['', '<!-- /field -->']:
            doc['values']['chapter/k01/intro'] = value
            with self.assertRaises(ValueError):
                local_content.save(self.root, {'group': 'k01', **doc})
            self.assertEqual((self.root / doc['path']).read_bytes(), before)

    def test_publish_batches_files_and_refuses_unrelated_changes(self):
        for group in ['k01', 'k02']:
            doc = local_content.document(self.root, group)
            doc['values'][f'chapter/{group}/intro'] += '\n\n本地更新。'
            local_content.save(self.root, {'group': group, **doc})
        before = git(self.root, 'rev-parse', 'HEAD')
        (self.root / 'unrelated.txt').write_text('Keep this file')
        with self.assertRaisesRegex(ValueError, '程序或结构修改'):
            local_content.publish(self.root)
        (self.root / 'unrelated.txt').unlink()
        result = local_content.publish(self.root)
        self.assertTrue(result['published'])
        self.assertEqual(result['pending'], 0)
        self.assertEqual(result['unpushed'], 0)
        self.assertEqual(git(self.root, 'rev-list', '--count', before+'..HEAD'), '1')
        self.assertEqual(set(git(self.root, 'diff', '--name-only', before, 'HEAD').splitlines()), {'content/documents/k01.md', 'content/documents/k02.md'})
        self.assertEqual(local_content.publish(self.root)['commit'], result['commit'])

    def test_publish_includes_new_question_and_both_registries(self):
        content = self.root / 'content'
        dataset = json.loads((content / 'doubao-interviews.json').read_text())
        existing = {path.name: path.read_bytes() for path in (content / 'documents').glob('*.md')}
        number = max(int(q['id'].split('-')[-1]) for q in dataset['questions'] if q['category'] == 'tech') + 1
        qid = f'db-tech-{number:02d}'
        question = {'id': qid, 'category': 'tech', 'title': '新增面试题发布验证：怎样确认引用真的支持结论？',
                    'framework': '检查原文、适用条件和版本。', 'answer': '我会先逐项对照原文，再确认结论适用于当前用户与时间。', 'supplement': ''}
        dataset['questions'].append(question)
        fields, values = [], {}
        for name, label in [('title', '面试题'), ('framework', '回答框架'), ('answer', '口述参考答案')]:
            key = f'doubao/{qid}/{name}'
            fields.append({'key': key, 'label': label, 'multiline': name != 'title'})
            values[key] = question[name]
        add_documents(content, [(qid, question['title'], fields, values)])
        (content / 'doubao-interviews.json').write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + '\n')
        before = git(self.root, 'rev-parse', 'HEAD')
        result = local_content.publish(self.root)
        self.assertEqual(result['pending'], 0)
        expected = {'content/documents.json', 'content/doubao-interviews.json', f'content/documents/{qid}.md'}
        self.assertEqual(set(git(self.root, 'diff', '--name-only', before, 'HEAD').splitlines()), expected)
        self.assertEqual(git(self.root, 'rev-parse', 'HEAD'), git(self.root, 'rev-parse', 'origin/main'))
        for name, raw in existing.items():
            self.assertEqual((content / 'documents' / name).read_bytes(), raw)
        html = local_content.current_html(self.root).decode()
        data = json.loads(BeautifulSoup(html, 'html.parser').select_one('#handbook-data').string)
        self.assertIn(qid, [q['id'] for q in data['doubao']['questions']])
        self.assertEqual(len(data['chapters']), 36)
        self.assertEqual(sum(len(c['questions']) for c in data['chapters']), 108)

    def test_registry_only_publish_and_failed_push_retry(self):
        path = self.root / 'content/doubao-interviews.json'
        data = json.loads(path.read_text())
        data['sourceTitle'] = '更新来源说明，不修改题目'
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        self.assertEqual(local_content.status(self.root)['pending'], 0)
        original_run = local_content.run

        def disconnected(root, args, **kwargs):
            if args[:2] == ['git', 'push']:
                raise ValueError('Network unavailable')
            return original_run(root, args, **kwargs)

        with patch('local_content.run', side_effect=disconnected):
            with self.assertRaisesRegex(ValueError, '修改和本地提交均已保留'):
                local_content.publish(self.root)
        committed = git(self.root, 'rev-parse', 'HEAD')
        self.assertEqual(local_content.publish(self.root)['commit'], committed)
        self.assertFalse(git(self.root, 'status', '--porcelain'))

    def test_program_changes_are_named_and_never_staged(self):
        for path in ['server.py', 'content/layout.json', 'content/documents/extra-script.js']:
            with self.subTest(path=path):
                target = self.root / path
                old = target.read_bytes() if target.exists() else None
                target.write_bytes((old or b'') + b'\n')
                before = git(self.root, 'rev-parse', 'HEAD')
                with self.assertRaises(ValueError) as caught:
                    local_content.publish(self.root)
                self.assertIn(path, str(caught.exception))
                self.assertFalse(git(self.root, 'diff', '--cached', '--name-only'))
                self.assertEqual(before, git(self.root, 'rev-parse', 'HEAD'))
                if old is None:
                    target.unlink()
                else:
                    target.write_bytes(old)

    def test_remote_conflict_preserves_local_document(self):
        other = Path(self.temp.name) / 'other'
        git(self.root, 'clone', '--branch', 'main', str(self.remote), str(other))
        git(other, 'config', 'user.email', 'test@example.invalid')
        git(other, 'config', 'user.name', 'Test')
        path = 'content/documents/k01.md'
        (other / path).write_text((other / path).read_text().replace('先理解它在做什么', '远端已经改写'))
        git(other, 'add', path)
        git(other, 'commit', '-m', 'Remote change')
        git(other, 'push')
        doc = local_content.document(self.root, 'k01')
        doc['values']['chapter/k01/intro'] += '\n\n本地尚未发布。'
        local_content.save(self.root, {'group': 'k01', **doc})
        before = (self.root / path).read_bytes()
        with self.assertRaisesRegex(ValueError, '远端更新涉及'):
            local_content.publish(self.root)
        self.assertEqual((self.root / path).read_bytes(), before)

    def test_failed_push_can_retry_without_duplicate_commit(self):
        doc = local_content.document(self.root, 'k01')
        doc['values']['chapter/k01/intro'] += '\n\n等待网络恢复。'
        local_content.save(self.root, {'group': 'k01', **doc})
        original_run = local_content.run

        def disconnected(root, args, **kwargs):
            if args[:2] == ['git', 'push']:
                raise ValueError('Network unavailable')
            return original_run(root, args, **kwargs)

        with patch('local_content.run', side_effect=disconnected):
            with self.assertRaisesRegex(ValueError, '修改和本地提交均已保留'):
                local_content.publish(self.root)
        committed = git(self.root, 'rev-parse', 'HEAD')
        self.assertEqual(local_content.status(self.root)['unpushed'], 1)
        self.assertEqual(local_content.publish(self.root)['commit'], committed)


if __name__ == '__main__':
    unittest.main()
