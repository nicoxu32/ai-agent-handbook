"""Render safe reading formats and persist selections as ordinary Markdown."""
import re
from bs4 import BeautifulSoup, Comment, NavigableString, Tag
import markdown
from markdown.preprocessors import Preprocessor
from markdownify import MarkdownConverter
from source_blocks import attach_source_blocks

CALLOUTS = {'NOTE': '重点摘记', 'KEY': '核心理解', 'TIP': '边界与易错点', 'SUPPLEMENT': '补充理解'}
IMAGE = re.compile(r'(?:\.\./images/|media/)([a-f0-9]{64}\.(?:png|jpg|webp))\Z')


class ReadingBlocks(Preprocessor):
    def run(self, lines):
        # Code and raw HTML have already been stashed by the earlier preprocessors.
        text = '\n'.join(lines)
        return re.sub(r'(\n[ \t]*\n)(?=>)', r'\1<!-- reading-block -->\n\n', text).split('\n')


def render_markdown(text):
    text = re.sub(r'<a id="k\d+"></a>', '', text)
    renderer = markdown.Markdown(extensions=['tables', 'fenced_code', 'nl2br'])
    renderer.preprocessors.register(ReadingBlocks(renderer), 'reading_blocks', 15)
    html = renderer.convert(text)
    soup = BeautifulSoup(html, 'html.parser')
    allowed = {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 'del', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'hr', 'br', 'div', 'span', 'small', 'img'}
    for tag in list(soup.find_all(True)):
        if tag.name is None:
            continue
        if tag.name in {'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'input'}:
            tag.decompose()
        elif tag.name not in allowed:
            tag.unwrap()
        else:
            tag.attrs = {key: value for key, value in tag.attrs.items() if key in {'href', 'title', 'class', 'role', 'aria-label', 'start'} or tag.name == 'img' and key in {'src', 'alt'}}
    for link in soup.find_all('a', href=True):
        if not re.match(r'^(https?://|#)', link['href'], re.I):
            del link['href']
        elif link['href'].startswith('https://'):
            link['target'] = '_blank'
            link['rel'] = 'noopener noreferrer'
    for image in list(soup.find_all('img')):
        match = IMAGE.fullmatch(image.get('src', ''))
        if not match:
            image.decompose()
            continue
        image['src'] = 'media/' + match[1]
        image['alt'] = image.get('alt', '')
        image['loading'] = 'lazy'
        image['decoding'] = 'async'
        image['class'] = 'reading-image'
        image['tabindex'] = '0'
        image['role'] = 'button'
        image['aria-label'] = '放大图片：' + image['alt']
        parent = image.parent
        if parent.name == 'p' and not parent.get_text().strip():
            parent['class'] = 'reading-figure'
            parent['data-caption'] = image['alt']
    for quote in soup.find_all('blockquote'):
        first = quote.find('p', recursive=False)
        if first is None or not first.contents or not isinstance(first.contents[0], NavigableString):
            continue
        marker = re.match(r'^\[!(NOTE|KEY|TIP|SUPPLEMENT)\][ \t]*', str(first.contents[0]))
        if not marker:
            continue
        node = first.contents[0]
        remainder = str(node)[marker.end():]
        node.replace_with(remainder)
        if not remainder and len(first.contents) > 1 and getattr(first.contents[1], 'name', None) == 'br':
            first.contents[1].decompose()
            # nl2br leaves a newline after the removed break.
            if len(first.contents) > 1 and isinstance(first.contents[1], NavigableString):
                first.contents[1].replace_with(str(first.contents[1]).lstrip('\n'))
        if not first.get_text().strip() and not first.find('img'):
            first.decompose()
        quote['class'] = ['reading-callout', 'callout-' + marker[1].lower()]
        quote['data-callout'] = marker[1]
        quote['data-label'] = CALLOUTS[marker[1]]
    for quote in soup.find_all('blockquote'):
        for edge in [0, -1]:
            while quote.contents and isinstance(quote.contents[edge], NavigableString) and not str(quote.contents[edge]).strip():
                quote.contents[edge].extract()
    for table in soup.find_all('table'):
        wrapper = soup.new_tag('div', attrs={'class': 'table-scroll', 'tabindex': '0', 'aria-label': '可横向滚动的表格'})
        table.wrap(wrapper)
    return str(soup)


class ReadingConverter(MarkdownConverter):
    def convert_u(self, el, text, parent_tags):
        return '<u>' + text + '</u>'

    def convert_blockquote(self, el, text, parent_tags):
        marker = el.get('data-callout')
        if marker in CALLOUTS:
            text = f'[!{marker}]\n\n' + text.lstrip('\n')
        return super().convert_blockquote(el, text, parent_tags)

    def convert_img(self, el, text, parent_tags):
        match = IMAGE.fullmatch(el.get('src', ''))
        if match:
            el['src'] = '../images/' + match[1]
        return super().convert_img(el, text, parent_tags)


def markdown_from_editor(html):
    """Convert schema-based editor HTML, checking the round trip before saving."""
    if not isinstance(html, str) or len(html) > 240000:
        raise ValueError('编辑内容过长或格式无效，请缩短此分区。')
    soup = BeautifulSoup(html, 'html.parser')
    allowed = {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong',
               'em', 'b', 'i', 'u', 's', 'del', 'blockquote', 'pre', 'code', 'table',
               'thead', 'tbody', 'tr', 'th', 'td', 'a', 'hr', 'br', 'img'}
    for node in list(soup.find_all(True)):
        if node.name is None:
            continue
        if node.name in {'script', 'style', 'iframe', 'object', 'embed', 'svg', 'form'}:
            node.decompose()
        elif node.name not in allowed:
            node.unwrap()
        else:
            if node.name in {'td', 'th'} and any(str(node.get(key, '1')) != '1' for key in ['colspan', 'rowspan']):
                raise ValueError('Markdown 表格不支持合并单元格，请拆开单元格后保存。')
            attributes = {'a': {'href', 'title'}, 'img': {'src', 'alt', 'title'},
                          'blockquote': {'data-callout'}, 'code': {'class'}, 'ol': {'start'}}.get(node.name, set())
            node.attrs = {key: value for key, value in node.attrs.items() if key in attributes}
            if node.name == 'blockquote' and node.get('data-callout') not in CALLOUTS:
                node.attrs = {}
            if node.name == 'a' and not re.match(r'^(https?://|#)', node.get('href', ''), re.I):
                node.unwrap()
                continue
            if node.name == 'img' and not IMAGE.fullmatch(node.get('src', '')):
                raise ValueError('请使用「插入图片」将图片存到本地后再保存，不支持外部图片地址。')
            if node.name == 's':
                node.name = 'del'
    for comment in soup.find_all(string=lambda value: isinstance(value, Comment)):
        comment.extract()

    def language(pre):
        classes = pre.code.get('class', []) if pre.code else []
        return next((name[9:] for name in classes if name.startswith('language-')), '')

    converted = ReadingConverter(heading_style='ATX', bullets='-', newline_style='SPACES',
                                 escape_underscores=True, code_language_callback=language).convert(str(soup)).strip()
    checked = BeautifulSoup(render_markdown(converted), 'html.parser')
    def normalize(text):
        return re.sub(r'\s+', '', text)

    def signature(tree, tag, attr):
        result = []
        for node in tree.find_all(tag):
            value = node.get(attr)
            if tag == 'img':
                value = (value.removeprefix('../images/').removeprefix('media/'), node.get('alt', ''))
            result.append(value)
        return result

    if normalize(soup.get_text()) != normalize(checked.get_text()):
        raise ValueError('此段排版无法完整转换为 Markdown，尚未保存。请下载草稿后调整复杂结构。')
    for tag, attr in [('img', 'src'), ('a', 'href'), ('blockquote', 'data-callout')]:
        if signature(soup, tag, attr) != signature(checked, tag, attr):
            raise ValueError('图片、链接或补充块无法完整保存，请保留草稿并检查排版。')
    for tag in ['table', 'pre']:
        if [normalize(node.get_text()) for node in soup.find_all(tag)] != [normalize(node.get_text()) for node in checked.find_all(tag)]:
            raise ValueError('表格或代码无法完整保存，请保留草稿并检查排版。')
    return converted


def codepoint_offset(text, offset):
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        raise ValueError('选区位置无效，请重新选择文字。')
    raw = text.encode('utf-16-le')
    if offset * 2 > len(raw):
        raise ValueError('选区超出原文范围。')
    try:
        return len(raw[:offset * 2].decode('utf-16-le'))
    except UnicodeDecodeError:
        raise ValueError('选区截断了字符，请重新选择。') from None


def format_markdown(source, start, end, quote, style):
    if style not in {'bold', 'code', 'underline', 'block', 'number'}:
        raise ValueError('请选择有效的文字样式。')
    soup = BeautifulSoup(render_markdown(source), 'html.parser')
    text = soup.get_text()
    start, end = codepoint_offset(text, start), codepoint_offset(text, end)
    if start >= end or not isinstance(quote, str) or text[start:end] != quote or not quote.strip():
        raise ValueError('选中文字与原文不匹配，请刷新后重新选择。')
    records = attach_source_blocks(source, soup, 'format', render_markdown)
    roots, offset = [], 0
    for node in soup.contents:
        if isinstance(node, Comment):
            continue
        length = len(node.get_text()) if isinstance(node, Tag) else len(str(node))
        if isinstance(node, Tag) and start < offset + length and end > offset:
            index = node.get('data-append-index')
            if index is None or records[int(index)].get('start') is None:
                raise ValueError('此段包含跨段引用，请通过顶部编辑功能调整格式。')
            roots.append((node, records[int(index)]))
        offset += length
    if not roots:
        raise ValueError('未找到完整段落，请重新选择。')
    if style in {'block', 'number'}:
        if len(roots) == 1 and (style == 'number' and roots[0][0].name == 'ol' or
                               style == 'block' and roots[0][0].get('data-callout') == 'NOTE'):
            return source
        container = soup.new_tag('blockquote', attrs={'data-callout': 'NOTE'}) if style == 'block' else soup.new_tag('ol')
        roots[0][0].insert_before(container)
        for node, _ in roots:
            if style == 'number':
                item = soup.new_tag('li')
                item.append(node.extract())
                container.append(item)
            else:
                container.append(node.extract())
        fragment = str(container)
    else:
        tag_name = {'bold': 'strong', 'code': 'code', 'underline': 'u'}[style]
        offset = 0
        for node in list(soup.descendants):
            if not isinstance(node, NavigableString) or isinstance(node, Comment):
                continue
            value = str(node)
            left, right = max(0, start - offset), min(len(value), end - offset)
            offset += len(value)
            if left >= right or node.find_parent(tag_name):
                continue
            if node.find_parent('pre') or node.find_parent('code'):
                raise ValueError('代码内容请在编辑弹窗中修改，避免改变代码含义。')
            selected = value[left:right]
            left += len(selected) - len(selected.lstrip())
            right -= len(selected) - len(selected.rstrip())
            if left >= right:
                continue
            replacement = []
            if left:
                replacement.append(NavigableString(value[:left]))
            wrapper = soup.new_tag(tag_name)
            wrapper.string = value[left:right]
            replacement.append(wrapper)
            if right < len(value):
                replacement.append(NavigableString(value[right:]))
            node.replace_with(*replacement)
        fragment = '\n'.join(str(node) for node, _ in roots)
    converted = ReadingConverter(heading_style='ATX', bullets='-', newline_style='SPACES', escape_underscores=True).convert(fragment).strip()
    first, last = roots[0][1], roots[-1][1]
    raw_start = codepoint_offset(source, first['start'])
    raw_end = codepoint_offset(source, last['end'])
    result = source[:raw_start].rstrip('\n') + ('\n\n' if raw_start else '') + converted + source[raw_end:]
    # Never persist a conversion that changes the reading text or removes an image/link/table.
    checked = BeautifulSoup(render_markdown(result), 'html.parser')
    original = BeautifulSoup(render_markdown(source), 'html.parser')
    if re.sub(r'\s+', '', checked.get_text()) != re.sub(r'\s+', '', text):
        raise ValueError('此选区无法安全转换，请在顶部编辑功能中调整格式。')
    for tag, attr in [('img', 'src'), ('a', 'href'), ('table', None), ('pre', None)]:
        before = [node.get(attr) if attr else node.get_text() for node in original.find_all(tag)]
        after = [node.get(attr) if attr else node.get_text() for node in checked.find_all(tag)]
        if before != after:
            raise ValueError('此选区包含复杂结构，请在顶部编辑功能中调整格式。')
    return result
