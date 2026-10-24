"""Verify incremental imports preserve published IDs and existing content."""

import json
from html import escape
import unittest
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from scripts.sync_doubao import merge_questions, parse_questions, read_snapshot


def message(index, body):
    return {'message_id': str(index), 'index_in_conv': str(index), 'user_type': 2,
            'content_block': [{'block_type': 10000, 'content': {'text_block': {'text': body}}}]}


def question(category, title, message_id):
    return {'category': category, 'title': title, 'answer': 'Source answer', 'framework': 'Source framework',
            'supplement': '', 'sourceMessage': 1, 'sourceMessageId': message_id}


class DoubaoSyncTests(unittest.TestCase):
    def test_apply_creates_markdown_without_changing_existing_documents(self):
        from test_local_content import copy_project, ROOT
        from content_store import load_documents
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            copy_project(root)
            (root / 'scripts').mkdir()
            shutil.copyfile(ROOT / 'scripts/sync_doubao.py', root / 'scripts/sync_doubao.py')
            before = {p.name: p.read_bytes() for p in (root / 'content/documents').glob('*.md')}
            original_count = len(json.loads((root / 'content/doubao-interviews.json').read_text())['questions'])
            answer = '新增完整口述答案，讨论证据与实际取舍。' * 15
            body = f'## 题目二｜AI 技术知识点方向\n\n**题干：** 如何验证新增的隔离测试题目？\n\n**框架：**\n1. 核对来源\n\n**口述参考答案：**\n\n{answer}'
            data = {'data': {'share_info': {'message_index_end': '2'}, 'message_snapshot': {'message_list': [message(2, body)]}}}
            payload = ['thread_(token)/page', 'shareInfo', data]
            html = root / 'fixture.html'
            html.write_text(f'<script data-fn-args="{escape(json.dumps(payload), quote=True)}"></script>')
            result = subprocess.run([sys.executable, 'scripts/sync_doubao.py', '--html', str(html), '--apply'], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            added = json.loads(result.stdout)['added']
            self.assertEqual(len(added), 1)
            _, values, _ = load_documents(root / 'content')
            self.assertEqual(values[f'doubao/{added[0]}/answer'], answer)
            for name, original in before.items():
                self.assertEqual((root / 'content/documents' / name).read_bytes(), original)
            built = subprocess.run([sys.executable, 'build.py', '--static'], cwd=root, capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stderr)
            self.assertIn(f'{original_count + len(added)} Doubao questions', built.stdout)

    def test_append_preserves_existing_and_second_run_is_noop(self):
        old = {**question('pm', '如何评估 AI？', 'old'), 'id': 'db-pm-17', 'supplement': 'Keep this supplement'}
        original = {'sourceUrl': 'https://www.doubao.com/thread/old', 'questions': [old]}
        incoming = [question('pm', '如何评估AI?', 'old'), question('tech', '如何设计缓存？', 'new')]
        merged, added, _ = merge_questions(original, incoming, 'https://www.doubao.com/thread/new')
        self.assertEqual(merged['questions'][0], old)
        self.assertEqual(original['questions'], [old])
        self.assertEqual(added, ['db-tech-01'])
        again, added, _ = merge_questions(merged, incoming, 'https://www.doubao.com/thread/new')
        self.assertEqual(again, merged)
        self.assertEqual(added, [])

    def test_renamed_or_revised_source_does_not_overwrite(self):
        old = {**question('pm', '原题怎么答？', 'same'), 'id': 'db-pm-99'}
        original = {'sourceUrl': 'old', 'questions': [old]}
        incoming = [question('pm', '重新写过的题干？', 'same'), question('pm', '另一道新的问题？', 'new')]
        merged, added, revisions = merge_questions(original, incoming, 'new')
        self.assertEqual(merged['questions'][0], old)
        self.assertEqual(added, ['db-pm-100'])
        self.assertEqual(revisions, ['db-pm-99'])

    def test_parser_preserves_complete_answer_and_ignores_user_instructions(self):
        answer = '这是原文中的口述答案。' * 10
        body = f'## 题目二｜AI 技术知识点方向\n\n**题干：** 如何实现上下文缓存？\n\n**框架：**\n1. 前缀复用\n\n**口述参考答案：**\n\n{answer}\n\n---\n\n本轮结束。'
        instruction = message(1, body)
        instruction['user_type'] = 1
        questions = parse_questions([instruction, message(2, body)])
        self.assertEqual(len(questions), 1)
        self.assertEqual(questions[0]['answer'], answer)
        self.assertEqual(questions[0]['category'], 'tech')
        self.assertEqual(questions[0]['framework'], '1. 前缀复用')
        with self.assertRaises(ValueError):
            parse_questions([message(3, '## 题目一｜AI 产品经理\n**题干：** 未完成的题目')])

    def test_incomplete_snapshot_or_login_page_is_rejected(self):
        data = {'data': {'share_info': {'message_index_end': '10'}, 'message_snapshot': {'message_list': [message(9, 'text')]}}}
        args = ['thread_(token)/page', [{'key': 'shareInfo', 'routerDataFnName': 'p', 'routerDataFnArgs': [json.dumps(data)]}]]
        html = f'<script data-fn-args="{escape(json.dumps(args), quote=True)}"></script>'
        with self.assertRaises(ValueError):
            read_snapshot(html)
        with self.assertRaises(ValueError):
            read_snapshot('<html>Please log in</html>')

    def test_immediate_and_streamed_snapshots_are_equivalent(self):
        data = {'data': {'share_info': {'message_index_end': '2'}, 'message_snapshot': {'message_list': [message(2, 'text')]}}}
        immediate = ['thread_(token)/page', [{'key': 'shareInfo', 'routerDataFnName': 'p', 'routerDataFnArgs': [json.dumps(data)]}]]
        pending = ['thread_(token)/page', [{'key': 'shareInfo', 'routerDataFnName': 's', 'routerDataFnArgs': ['"thread_(token)/page"', '"shareInfo"']}]]
        resolved = ['thread_(token)/page', 'shareInfo', data]
        wrap = lambda value: f'<script data-fn-args="{escape(json.dumps(value), quote=True)}"></script>'
        self.assertEqual(read_snapshot(wrap(immediate)), read_snapshot(wrap(pending) + wrap(resolved)))


if __name__ == '__main__':
    unittest.main()
