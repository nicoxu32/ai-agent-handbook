"""Check that insertion boundaries preserve complete Markdown structures."""
import unittest
import markdown
from bs4 import BeautifulSoup
from source_blocks import attach_source_blocks


def render(source):
    return markdown.markdown(source, extensions=['tables', 'fenced_code'])


class SourceBlockTests(unittest.TestCase):
    def test_complete_blocks_and_utf16_offsets(self):
        samples = [
            '第一段 **重点** 😀。\n\n第二段。',
            '- 第一项\n\n- 第二项\n\n结尾。',
            '| 列一 | 列二 |\n| --- | --- |\n| 内容 | 示例 |\n\n结尾。',
            '```json\n{"value": 1}\n\n{"value": 2}\n```\n\n结尾。',
            '> 引用一\n>\n> 引用二\n\n结尾。',
            '重复段落。\n\n重复段落。',
        ]
        for source in samples:
            with self.subTest(source=source):
                soup = BeautifulSoup(render(source), 'html.parser')
                records = attach_source_blocks(source, soup, 'test', render)
                roots = soup.find_all(recursive=False)
                self.assertEqual(len(records), len(roots))
                for index, record in enumerate(records):
                    prefix = source.encode('utf-16-le')[:record['end'] * 2].decode('utf-16-le')
                    before = BeautifulSoup(render(prefix), 'html.parser').find_all(recursive=False)
                    self.assertEqual(len(before), index + 1)
                    self.assertEqual(before[-1].get_text(), record['text'])
                    combined = prefix + '\n\n补充段落。\n\n' + source[len(prefix):].lstrip('\n')
                    after = BeautifulSoup(render(combined), 'html.parser').find_all(recursive=False)
                    self.assertEqual(after[index].get_text(), record['text'])
                    self.assertEqual(after[index + 1].get_text(), '补充段落。')

    def test_unresolved_reference_is_not_guessed(self):
        source = '第一段 [链接][ref]。\n\n后面内容。\n\n[ref]: https://example.com'
        soup = BeautifulSoup(render(source), 'html.parser')
        records = attach_source_blocks(source, soup, 'test', render)
        self.assertFalse(soup.p.has_attr('data-append-index'))
        self.assertEqual(len(records), 1)


if __name__ == '__main__':
    unittest.main()
