"""Verify formatting across nested inline syntax without rewriting other blocks."""
import base64
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from bs4 import BeautifulSoup
from PIL import Image
from image_assets import upload, asset_path, export_images
from rich_text import format_markdown, render_markdown, markdown_from_editor


def formatted(source, word, style):
    text = BeautifulSoup(render_markdown(source), 'html.parser').get_text()
    start = text.index(word)
    offsets = [len(text[:i].encode('utf-16-le')) // 2 for i in [start, start + len(word)]]
    return format_markdown(source, *offsets, word, style)


class RichTextTests(unittest.TestCase):
    def test_document_editor_preserves_tables_callouts_images_code_and_line_breaks(self):
        name = 'b' * 64 + '.jpg'
        source = f'### 面试问题？\n\n第一行。\n第二行 <u>重点</u>。\n\n> [!SUPPLEMENT]\n>\n> 补充 **解释**。\n\n| 名称 | 说明 |\n| --- | --- |\n| 词元 | 文本单元 |\n\n![流程说明](../images/{name})\n\n```python\nprint(1)\n```'
        before = BeautifulSoup(render_markdown(source), 'html.parser')
        converted = markdown_from_editor(str(before))
        after = BeautifulSoup(render_markdown(converted), 'html.parser')
        self.assertEqual(before.get_text().split(), after.get_text().split())
        self.assertIsNotNone(after.select_one('.callout-supplement'))
        self.assertEqual(after.img['src'], 'media/' + name)
        self.assertIn('../images/' + name, converted)
        self.assertEqual(after.select_one('pre code')['class'], ['language-python'])
        self.assertEqual(len(after.select('table td')), 2)
        self.assertEqual(after.u.get_text(), '重点')

    def test_editor_conversion_rejects_lossy_tables_and_external_images_and_sanitizes_html(self):
        for html in ['<table><tr><td colspan="2">合并</td></tr></table>',
                     '<p><img src="https://example.org/tracker.png"></p>']:
            with self.assertRaises(ValueError):
                markdown_from_editor(html)
        converted = markdown_from_editor('<p onclick="alert(1)">正文 <strong>重点</strong></p><script>alert(1)</script><a href="javascript:alert(1)">链接文字</a>')
        self.assertIn('**重点**', converted)
        self.assertNotIn('alert', converted)
        self.assertNotIn('javascript', converted)

    def test_nested_formats_emoji_repeated_words_and_untouched_blocks(self):
        source = '第一段 😀 **已有重点** 和链接 [原文](https://example.org)。\n\n第二段 原文。'
        for style, selector in [('bold', 'strong'), ('underline', 'u'), ('code', 'code'), ('block', '.callout-note')]:
            with self.subTest(style=style):
                result = formatted(source, '已有重点 和链接', style)
                soup = BeautifulSoup(render_markdown(result), 'html.parser')
                self.assertTrue(soup.select(selector))
                self.assertIn('\n\n第二段 原文。', result)
                self.assertEqual(soup.a['href'], 'https://example.org')
                self.assertEqual(soup.get_text().replace('\n', ''), BeautifulSoup(render_markdown(source), 'html.parser').get_text().replace('\n', ''))
        text = BeautifulSoup(render_markdown(source), 'html.parser').get_text()
        start = len(text[:text.rindex('原文')].encode('utf-16-le')) // 2
        result = format_markdown(source, start, start + 2, '原文', 'underline')
        self.assertTrue(result.startswith(source.split('\n\n')[0]))
        self.assertIn('第二段 <u>原文</u>', result)

    def test_blocks_preserve_lists_tables_and_existing_supplements(self):
        for source, word in [('- 第一项\n- 第二项', '第二项'),
                             ('| 名称 | 说明 |\n| --- | --- |\n| 词元 | 文本单元 |', '词元'),
                             ('> [!SUPPLEMENT]\n> 已有 **补充**。\n>\n> 不应丢失。', '补充')]:
            for style in ['bold', 'underline', 'code', 'block']:
                with self.subTest(source=source, style=style):
                    result = formatted(source, word, style)
                    soup = BeautifulSoup(render_markdown(result), 'html.parser')
                    if source.startswith('>'):
                        self.assertIsNotNone(soup.select_one('.callout-supplement'))
                    if source.startswith('|'):
                        self.assertEqual(len(soup.select('table td')), 2)
                    if source.startswith('-'):
                        self.assertEqual([li.get_text() for li in soup.select('li')], ['第一项', '第二项'])

    def test_cross_paragraph_selection_and_mismatches(self):
        source = '前面一句。\n\n后面一句。\n\n保持不变。'
        result = formatted(source, '一句。\n后面', 'bold')
        self.assertIn('**一句。**', result)
        self.assertIn('**后面**', result)
        self.assertTrue(result.endswith('\n\n保持不变。'))
        for start, end, quote in [(0, 2, '不同'), (0, 999, '错误'), (False, 2, '前面')]:
            with self.assertRaises(ValueError):
                format_markdown(source, start, end, quote, 'bold')

    def test_rendering_sanitizes_images_and_executable_markup(self):
        name = 'a' * 64 + '.png'
        source = f'> [!SUPPLEMENT]\n> 追问补充 <u>重点</u>。\n\n![流程说明](../images/{name})\n\n<img src="https://example.org/track.png" onerror="alert(1)"><script>alert(1)</script>'
        soup = BeautifulSoup(render_markdown(source), 'html.parser')
        self.assertEqual(soup.select_one('.callout-supplement')['data-label'], '补充理解')
        self.assertNotIn('[!SUPPLEMENT]', soup.get_text())
        self.assertEqual(soup.u.get_text(), '重点')
        self.assertEqual(len(soup.select('img')), 1)
        self.assertEqual(soup.img['src'], 'media/' + name)
        self.assertNotIn('onerror', str(soup))
        self.assertIsNone(soup.find('script'))

    def test_adjacent_cards_stay_separate_after_formatting(self):
        source = '选中这个段落。\n\n> 口述示范。\n\n> [!TIP]\n>\n> 后面的提醒。'
        result = formatted(source, '这个', 'block')
        soup = BeautifulSoup(render_markdown(result), 'html.parser')
        self.assertEqual(len(soup.select('blockquote')), 3)
        self.assertEqual(soup.select_one('.callout-note').get_text().strip(), '选中这个段落。')
        self.assertEqual(soup.select_one('.callout-tip').get_text().strip(), '后面的提醒。')
        self.assertNotIn('[!TIP]', soup.get_text())

    def test_card_separators_do_not_change_code(self):
        code = 'first\n\n> quoted in code\n'
        source = '```text\n' + code + '```\n\n后面的正文。'
        soup = BeautifulSoup(render_markdown(source), 'html.parser')
        self.assertEqual(soup.pre.code.get_text(), code)
        result = formatted(source, '正文', 'bold')
        self.assertEqual(BeautifulSoup(render_markdown(result), 'html.parser').pre.code.get_text(), code)


class ImageAssetTests(unittest.TestCase):
    def test_validate_normalize_deduplicate_and_export(self):
        with tempfile.TemporaryDirectory() as directory:
            content = Path(directory) / 'content'
            content.mkdir()
            image = Image.new('RGB', (2500, 50), 'green')
            raw = BytesIO()
            image.save(raw, format='PNG')
            body = {'data': base64.b64encode(raw.getvalue()).decode()}
            result = upload(content, body)
            self.assertEqual(upload(content, body), result)
            name = result['path'].rsplit('/', 1)[-1]
            path = asset_path(content, name)
            with Image.open(path) as loaded:
                self.assertEqual(loaded.width, 2400)
                self.assertFalse(loaded.getexif())
            self.assertEqual(len(list(path.parent.iterdir())), 1)
            output = Path(directory) / 'site'
            export_images(content, output)
            self.assertEqual((output / 'media' / name).read_bytes(), path.read_bytes())
            for invalid in ['../.env', 'x.svg', 'a' * 64 + '.svg']:
                with self.assertRaises(ValueError):
                    asset_path(content, invalid)
            for data in ['invalid base64', base64.b64encode(b'<svg onload="alert(1)"/>').decode()]:
                with self.assertRaises(ValueError):
                    upload(content, {'data': data})
            path.unlink()
            path.symlink_to(content / '.env')
            with self.assertRaises(ValueError):
                asset_path(content, name)


if __name__ == '__main__':
    unittest.main()
