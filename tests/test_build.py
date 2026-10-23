"""Verify editable content remains consistent and cannot inject executable HTML."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class EditableBuildTests(unittest.TestCase):
    def build(self, edits):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            for name in ['build.py', 'template.html', 'workspace.js', 'workspace.css', 'editor.js', 'doubao.js', 'architecture.json']:
                shutil.copyfile(ROOT / name, target / name)
            shutil.copytree(ROOT / 'content', target / 'content')
            (target / 'content/edits.json').write_text(json.dumps(edits), encoding='utf-8')
            result = subprocess.run([sys.executable, 'build.py', '--static'], cwd=target, env=os.environ, capture_output=True, text=True)
            if result.returncode:
                return result, None
            html = (target / 'index.html').read_text(encoding='utf-8')
            data = json.loads(re.search(r'<script id="handbook-data" type="application/json">(.*?)</script>', html, re.S).group(1))
            return result, data

    def test_edits_update_reading_search_questions_and_export(self):
        edits = {
            'chapter/k01/title': '模型学习：编辑后的标题',
            'chapter/k01/intro': '新的讲解关键词。\n\n第二段内容。',
            'question/01.1/title': '编辑后的面试题怎么回答？',
            'question/01.1/answer': '先说判断，再解释原因。',
            'guide': '更新后的学习指南。',
            'round/0/title': '第一轮更新',
            'glossary/0/example': '新的术语案例。',
            'architecture/goal/input': '更新后的任务输入',
        }
        result, data = self.build(edits)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(data['chapters']), 36)
        self.assertEqual(sum(len(chapter['questions']) for chapter in data['chapters']), 108)
        chapter = data['chapters'][0]
        self.assertEqual(chapter['short'], '模型学习')
        self.assertIn('新的讲解关键词', chapter['intro'])
        self.assertIn('编辑后的面试题', chapter['search'])
        self.assertIn('先说判断', chapter['questions'][0]['answer'])
        for value in edits.values():
            self.assertIn(value, data['source'])

    def test_markdown_strips_executable_html_but_preserves_formatting(self):
        result, data = self.build({'chapter/k01/intro': '<script>alert(1)</script><p onclick="alert(1)">正文 <strong>重点</strong></p><a href="javascript:alert(1)">链接</a><img src=x onerror=alert(1)><iframe src="https://example.org"></iframe>'})
        self.assertEqual(result.returncode, 0, result.stderr)
        intro = data['chapters'][0]['intro']
        for value in ['<script', 'onclick', 'javascript:', '<img', '<iframe']:
            self.assertNotIn(value, intro)
        self.assertIn('<strong>重点</strong>', intro)

    def test_rejects_unknown_or_empty_fields(self):
        for edits in [{'nonexistent': 'text'}, {'guide': ''}, {'chapter/k01/title': 'a\nb'}]:
            result, _ = self.build(edits)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('ValueError', result.stderr)

    def test_doubao_import_preserves_answers_categories_and_export(self):
        original = json.loads((ROOT / 'content/doubao-interviews.json').read_text(encoding='utf-8'))
        result, data = self.build({})
        self.assertEqual(result.returncode, 0, result.stderr)
        questions = data['doubao']['questions']
        self.assertEqual(len(questions), 33)
        self.assertEqual(sum(q['category'] == 'pm' for q in questions), 17)
        self.assertEqual(sum(q['category'] == 'tech' for q in questions), 16)
        self.assertEqual(sum(bool(q['supplement']) for q in questions), 2)
        for question in original['questions']:
            self.assertIn(question['title'], data['doubao']['source'])
            self.assertIn(question['answer'], data['doubao']['source'])
            if question['framework']:
                self.assertIn(question['framework'], data['doubao']['source'])

    def test_doubao_edits_update_answers_search_and_download(self):
        edits = {
            'doubao/db-tech-01/title': 'RAG 编辑后的问题',
            'doubao/db-tech-01/framework': '1. 先检索证据\n2. 再回答',
            'doubao/db-tech-01/answer': '这是修改后的口述答案。',
        }
        result, data = self.build(edits)
        self.assertEqual(result.returncode, 0, result.stderr)
        question = next(q for q in data['doubao']['questions'] if q['id'] == 'db-tech-01')
        self.assertEqual(question['title'], edits['doubao/db-tech-01/title'])
        self.assertIn('这是修改后的口述答案', question['answer'])
        self.assertIn('这是修改后的口述答案', question['search'])
        for value in edits.values():
            self.assertIn(value, data['doubao']['source'])


if __name__ == '__main__':
    unittest.main()
