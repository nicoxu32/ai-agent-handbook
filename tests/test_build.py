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
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]


class EditableBuildTests(unittest.TestCase):
    def build(self, edits):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            for name in ['build.py', 'template.html', 'workspace.js', 'workspace.css', 'editor.js', 'highlights.js', 'append.js', 'terms.js', 'source_blocks.py', 'doubao.js', 'architecture.json']:
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
            'chapter/k01/scenarios': '应用案例：售后工单分流。',
            'chapter/k01/troubleshooting': '故障排查：核对状态回执。',
            'question/01.1/title': '编辑后的面试题怎么回答？',
            'question/01.1/answer': '先说判断，再解释原因。',
            'round/0/description': '更新后的学习目标。',
            'round/0/title': '第一轮更新',
            'chapter/k08/intro': 'Embedding 把内容转成向量。比如把口语问题与制度条款联系起来。',
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
        for key in ['scenarios', 'troubleshooting']:
            value = edits[f'chapter/k01/{key}']
            self.assertIn(value, chapter[key])
            self.assertIn(value, chapter['search'])
        self.assertNotIn('应用案例：售后工单分流', chapter['decision'])
        self.assertNotIn('故障排查：核对状态回执', chapter['scenarios'])
        question_ids = []
        for item in data['chapters']:
            for key in ['intro', 'decision', 'scenarios', 'troubleshooting']:
                self.assertTrue(item[key].strip())
            self.assertEqual([q['id'] for q in item['questions']], [f"{item['number']}.{i}" for i in range(1, 4)])
            question_ids.extend(q['id'] for q in item['questions'])
        self.assertEqual(len(set(question_ids)), 108)
        self.assertNotIn('glossary', data)
        self.assertNotIn('guide', data)
        self.assertFalse(any(field['key'].startswith('glossary/') for field in data['editorFields']))
        self.assertEqual([extra['id'] for extra in data['extras']], ['extra0', 'extra1', 'extra2', 'extra4'])
        for value in edits.values():
            self.assertIn(value, data['source'])

    def test_markdown_strips_executable_html_but_preserves_formatting(self):
        result, data = self.build({'chapter/k01/intro': '<script>alert(1)</script><p onclick="alert(1)">正文 <strong>重点</strong></p><a href="javascript:alert(1)">链接</a><img src=x onerror=alert(1)><iframe src="https://example.org"></iframe>'})
        self.assertEqual(result.returncode, 0, result.stderr)
        intro = data['chapters'][0]['intro']
        for value in ['<script', 'onclick', 'javascript:', '<img', '<iframe']:
            self.assertNotIn(value, intro)
        self.assertIn('<strong>重点</strong>', intro)

    def test_editor_line_breaks_preserve_markdown_structure_and_append_positions(self):
        prose = '**训练和使用模型是两件事。**\n预训练：建立能力。\n后训练：针对性优化。\n推理：处理请求。'
        blocks = [prose, '下一段 😀。\n仍在本段。', '- 第一项\n- 第二项',
                  '| 名称 | 说明 |\n| --- | --- |\n| 推理 | 处理请求 |',
                  '```text\n第一行\n第二行\n```']
        source = '\n\n'.join(blocks)
        edits = {f'chapter/k01/{key}': source for key in ['intro', 'decision', 'scenarios', 'troubleshooting']}
        edits['question/01.1/answer'] = '先说结论。\n再讲原因。\n\n最后补充边界。'
        result, data = self.build(edits)
        self.assertEqual(result.returncode, 0, result.stderr)
        for key in ['intro', 'decision', 'scenarios', 'troubleshooting']:
            with self.subTest(section=key):
                soup = BeautifulSoup(data['chapters'][0][key], 'html.parser')
                paragraphs = soup.find_all('p')
                self.assertEqual(len(paragraphs), 2)
                self.assertEqual(len(paragraphs[0].find_all('br')), 3)
                self.assertEqual(len(paragraphs[1].find_all('br')), 1)
                self.assertEqual(paragraphs[0].strong.get_text(), '训练和使用模型是两件事。')
                self.assertEqual([li.get_text() for li in soup.select('ul li')], ['第一项', '第二项'])
                self.assertEqual(len(soup.select('table tbody tr')), 1)
                self.assertFalse(soup.select('table br, pre br'))
                self.assertEqual(soup.pre.code.get_text(), '第一行\n第二行\n')
                records = data['appendTargets'][f'chapter/k01/{key}']
                self.assertEqual(len(records), len(blocks))
                self.assertEqual(records[0]['end'], len(prose.encode('utf-16-le')) // 2)
                self.assertEqual(records[0]['text'], paragraphs[0].get_text())
        answer = BeautifulSoup(data['chapters'][0]['questions'][0]['answer'], 'html.parser')
        self.assertEqual(len(answer.find_all('p')), 2)
        self.assertEqual(len(answer.find_all('br')), 1)
        self.assertEqual(data['edits'], edits)
        self.assertIn(source, data['source'])

    def test_rejects_unknown_or_empty_fields(self):
        for edits in [{'nonexistent': 'text'}, {'round/0/description': ''}, {'chapter/k01/title': 'a\nb'}]:
            result, _ = self.build(edits)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('ValueError', result.stderr)

    def test_doubao_import_preserves_answers_categories_and_export(self):
        original = json.loads((ROOT / 'content/doubao-interviews.json').read_text(encoding='utf-8'))
        result, data = self.build({})
        self.assertEqual(result.returncode, 0, result.stderr)
        questions = data['doubao']['questions']
        self.assertEqual(len(questions), len(original['questions']))
        self.assertEqual([q['id'] for q in questions], [q['id'] for q in original['questions']])
        for category in original['categories']:
            self.assertEqual(sum(q['category'] == category for q in questions), sum(q['category'] == category for q in original['questions']))
        self.assertEqual(sum(bool(q['supplement']) for q in questions), sum(bool(q['supplement']) for q in original['questions']))
        for url in original.get('sources', [original['sourceUrl']]):
            self.assertIn(url, data['doubao']['source'])
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
