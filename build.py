from pathlib import Path
import argparse
import json
import re
import markdown
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'content' / 'handbook.md'
parser = argparse.ArgumentParser(description='Build the handbook for local use or static hosting')
parser.add_argument('--static', action='store_true', help='Build a static site without an AI backend')
parser.add_argument('--output', type=Path, default=ROOT / 'index.html')
args = parser.parse_args()
GROUPS = ['模型基础', '知识库与检索', '智能体执行', '多模态与集成', '企业平台能力', '产品设计与运营']
BOUNDS = [5, 13, 20, 24, 32, 36]
EDITS = json.loads((ROOT / 'content/edits.json').read_text(encoding='utf-8'))
if not isinstance(EDITS, dict) or any(not isinstance(key, str) or not isinstance(value, str) for key, value in EDITS.items()):
    raise ValueError('Edits must be a mapping of field names to text')
FIELDS = []


def editable(key, label, value, group, multiline=True):
    FIELDS.append({'key': key, 'label': label, 'value': value, 'group': group, 'multiline': multiline})
    result = EDITS.get(key, value)
    limit = 40000 if multiline else 300
    if not result.strip() or len(result) > limit or (not multiline and '\n' in result):
        raise ValueError(f'Invalid content for {key}')
    return result


def render(text):
    text = re.sub(r'<a id="k\d+"></a>', '', text)
    diagram = '''<div class="flow" role="img" aria-label="任务流程：用户目标经过权限和状态确认，工作流或智能体调用知识、工具和多模态能力，核验并交付结果；日志、评测和版本记录贯穿各步骤。"><div>用户目标与业务约束</div><span>↓</span><div>身份权限 · 任务状态 · 范围确认</div><span>↓</span><div>工作流 / Agent 选择下一步</div><span>↓</span><div class="flow-branches"><div>知识与检索</div><div>工具与接口</div><div>多模态理解</div></div><span>↓</span><div>模型处理 → 事实与授权检查 → 必要时人工确认</div><span>↓</span><div>核验真实执行状态 → 继续任务或交付结果</div><small>日志 · 评测 · 成本 · 版本记录贯穿全过程</small></div>'''
    text = re.sub(r'```mermaid\n.*?```', lambda _: diagram, text, flags=re.S)
    html = markdown.markdown(text, extensions=['tables', 'fenced_code'])
    soup = BeautifulSoup(html, 'html.parser')
    allowed = {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'del', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'hr', 'br', 'div', 'span', 'small'}
    for tag in list(soup.find_all(True)):
        if tag.name is None:
            continue
        if tag.name in {'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'input'}:
            tag.decompose()
        elif tag.name not in allowed:
            tag.unwrap()
        else:
            tag.attrs = {key: value for key, value in tag.attrs.items() if key in {'href', 'title', 'class', 'role', 'aria-label'}}
    for a in soup.find_all('a', href=True):
        if not re.match(r'^(https?://|#)', a['href'], re.I):
            del a['href']
            continue
        if a['href'].startswith('https://'):
            a['target'] = '_blank'
            a['rel'] = 'noopener noreferrer'
    for table in soup.find_all('table'):
        wrapper = soup.new_tag('div', attrs={'class': 'table-scroll', 'tabindex': '0', 'aria-label': '可横向滚动的表格'})
        table.wrap(wrapper)
    return str(soup)

source = SOURCE.read_text(encoding='utf-8')
chapters = []
section_labels = [
    ('intro', '先这样理解'),
    ('decision', '放到产品里怎么判断'),
    ('scenarios', '项目中的应用场景'),
    ('troubleshooting', '应用中经常遇到的问题'),
]
for match in re.finditer(r'^### (\d{2})｜(.+?)〔(P[012])〕\n(.*?)(?=^### \d{2}｜|^## |\Z)', source, re.M | re.S):
    number, title, priority, body = match.groups()
    title = editable(f'chapter/k{number}/title', '知识点标题', title, 'k' + number, False)
    sections = {}
    for index, (key, label) in enumerate(section_labels):
        next_marker = f'**{section_labels[index + 1][1]}**' if index + 1 < len(section_labels) else '**面试题 '
        marker = f'**{label}**'
        if body.count(marker) != 1 or next_marker not in body.split(marker, 1)[1]:
            raise ValueError(f'Chapter {number} must contain an ordered {label} section')
        raw = body.split(marker, 1)[1].split(next_marker, 1)[0].strip()
        sections[key] = editable(f'chapter/k{number}/{key}', label, raw, 'k' + number)
    questions = []
    for question in re.finditer(r'\*\*面试题 (\d{2}\.[123])｜(.+?)\*\*\s*\*\*口述答案：\*\*(.*?)(?=\*\*面试题 |<a id=|\Z)', body, re.S):
        qid, question_title, answer = question.groups()
        question_title = editable(f'question/{qid}/title', f'面试题 {qid}', question_title, 'k' + number, False)
        answer = editable(f'question/{qid}/answer', f'{qid} 口述答案', answer.strip(), 'k' + number)
        questions.append({'id': qid, 'title': question_title, 'answer': render(answer.strip())})
    group = next(i for i, bound in enumerate(BOUNDS) if int(number) <= bound)
    chapters.append({'id': 'k' + number, 'number': number, 'title': title, 'short': title.split('：')[0], 'priority': priority, 'group': group, **{key: render(value) for key, value in sections.items()}, 'questions': questions, 'search': title + '\n' + '\n'.join(sections.values()) + '\n' + '\n'.join(q['title'] + ' ' + BeautifulSoup(q['answer'], 'html.parser').get_text() for q in questions)})
intro = source.split('## 先说这份手册怎么用', 1)[1].split('## 一、模型基础', 1)[0]
appendix = source.split('## 七、', 1)[1]
metadata = source.split('\n', 1)[1].split('## 先说这份手册怎么用', 1)[0]
guide_markdown = editable('guide', '学习指南', intro.split('## 学习顺序与目录', 1)[0].strip(), 'home')
guide_html = render(guide_markdown)
extras = [{'id': 'guide', 'title': '阅读指南与学习顺序', 'html': render(metadata + '## 先说这份手册怎么用' + intro)}]
for i, match in enumerate(re.finditer(r'^## (.+?)\n(.*?)(?=^## |\Z)', '## 七、' + appendix, re.M | re.S)):
    extra_id = 'extra' + str(i)
    extra_markdown = editable(f'extra/{extra_id}', '配套阅读正文', match.group(0), extra_id)
    extras.append({'id': extra_id, 'title': match.group(1).split('、', 1)[-1], 'html': render(extra_markdown), 'markdown': extra_markdown})
if len(chapters) != 36 or any(len(c['questions']) != 3 for c in chapters):
    raise ValueError('Source must contain 36 chapters and three questions per chapter')
glossary = []
glossary_source = source.split('## 十、常用术语速查', 1)[1].split('## 十一、', 1)[0]
for line in glossary_source.splitlines():
    if line.startswith('|'):
        cells = [cell.strip() for cell in line.strip('|').split('|')]
        if len(cells) == 3 and re.search(r'\d{2}', cells[2]):
            glossary.append({'term': cells[0], 'explanation': cells[1], 'chapters': re.findall(r'\d{2}', cells[2])})
layout = json.loads((ROOT / 'content/layout.json').read_text(encoding='utf-8'))
for page_id, page in layout['pages'].items():
    for key, label in [('title', '页面标题'), ('description', '页面介绍')]:
        page[key] = editable(f'page/{page_id}/{key}', label, page[key], page_id, key != 'title')
for index, item in enumerate(glossary):
    for key, label in [('term', '术语'), ('explanation', '口语解释')]:
        item[key] = editable(f'glossary/{index}/{key}', label, item[key], f'glossary-{index}', key != 'term')
    item['example'] = editable(f'glossary/{index}/example', '场景例子', layout['examples'][index], f'glossary-{index}')
for index, item in enumerate(layout['rounds']):
    for key, label in [('title', '学习轮次标题'), ('description', '学习目标')]:
        item[key] = editable(f'round/{index}/{key}', f'第 {index + 1} 轮 · {label}', item[key], 'home', key != 'title')
architecture = json.loads((ROOT / 'architecture.json').read_text(encoding='utf-8'))
for node in architecture['nodes']:
    for key, label in [('title', '节点名称'), ('description', '节点说明'), ('input', '输入'), ('output', '产出')]:
        node[key] = editable(f"architecture/{node['id']}/{key}", label, node[key], 'arch-' + node['id'], key != 'title')
for trace_id, trace in architecture['traces'].items():
    for key, label in [('title', '路径名称'), ('description', '路径说明')]:
        trace[key] = editable(f'trace/{trace_id}/{key}', label, trace[key], 'trace-' + trace_id, key != 'title')
linked_ids = {number for node in architecture['nodes'] for number in node['chapters']}
if linked_ids != set(range(1, 37)):
    raise ValueError('Architecture must link all 36 knowledge points')
doubao = json.loads((ROOT / 'content/doubao-interviews.json').read_text(encoding='utf-8'))
doubao_sources = doubao.get('sources', [doubao['sourceUrl']])
doubao_export = ['# 豆包面试题', '来源：' + ' · '.join(f'[豆包分享 {index + 1}]({url})' for index, url in enumerate(doubao_sources)), '按原文整理。原文中的案例和经历表述为参考答案，不代表读者的真实履历。']
doubao_ids = set()
for question in doubao['questions']:
    qid = question['id']
    if qid in doubao_ids or question['category'] not in doubao['categories'] or not re.fullmatch(r'db-(pm|tech)-\d{2,}', qid):
        raise ValueError('Invalid or duplicate Doubao question')
    doubao_ids.add(qid)
    question['title'] = editable(f'doubao/{qid}/title', '面试题', question['title'], qid, False)
    doubao_export.append(f"## {doubao['categories'][question['category']]} · {qid.rsplit('-', 1)[-1]}\n\n{question['title']}")
    search_parts = [question['title']]
    for key, label in [('framework', '回答框架'), ('answer', '口述参考答案'), ('supplement', '原文补充：金句与案例')]:
        raw = question[key]
        if raw or key == 'answer':
            raw = editable(f'doubao/{qid}/{key}', label, raw, qid)
            doubao_export.extend(['### ' + label, raw])
        display_markdown = re.sub(r'(\*\*)\n(?=\d+\. )', r'\1\n\n', raw)
        question[key] = render(display_markdown) if raw else ''
        search_parts.append(BeautifulSoup(question[key], 'html.parser').get_text(' '))
    question['search'] = '\n'.join(search_parts)
doubao['source'] = '\n\n'.join(doubao_export) + '\n'
unknown = set(EDITS) - {field['key'] for field in FIELDS}
if unknown:
    raise ValueError(f'Unknown editable fields: {sorted(unknown)}')
values = {field['key']: EDITS.get(field['key'], field['value']) for field in FIELDS}
export = ['# AI 智能体学习手册', '## 学习指南', guide_markdown, '## 学习路径']
for item in layout['rounds']:
    export.extend(['### ' + item['title'], item['description'], '知识点：' + '、'.join(f'{number:02d}' for number in item['ids'])])
for group_index, group in enumerate(GROUPS):
    export.append('## ' + group)
    for chapter in (item for item in chapters if item['group'] == group_index):
        key = 'chapter/' + chapter['id']
        export.extend([f"<a id=\"{chapter['id']}\"></a>", f"### {chapter['number']}｜{chapter['title']}〔{chapter['priority']}〕", '**先这样理解**', values[key + '/intro'], '**放到产品里怎么判断**', values[key + '/decision']])
        export.extend(['**项目中的应用场景**', values[key + '/scenarios'], '**应用中经常遇到的问题**', values[key + '/troubleshooting']])
        for question in chapter['questions']:
            export.extend([f"**面试题 {question['id']}｜{question['title']}**", '**口述答案：**', values['question/' + question['id'] + '/answer']])
export.append('## 常用术语与场景')
for item in glossary:
    export.extend(['### ' + item['term'], item['explanation'], item['example'], '回看：' + '、'.join(item['chapters'])])
export.append('## 知识点任务架构图')
for node in architecture['nodes']:
    export.extend(['### ' + node['title'], node['description'], '输入：' + node['input'], '产出：' + node['output'], '关联知识点：' + '、'.join(str(number) for number in node['chapters'])])
export.append('## 任务路径说明')
for trace in architecture['traces'].values():
    export.extend(['### ' + trace['title'], trace['description']])
for extra in extras:
    if extra['id'] in {'extra1', 'extra2', 'extra4'}:
        export.append(extra['markdown'])
source = '\n\n'.join(export) + '\n'
payload = json.dumps({'groups': GROUPS, 'chapters': chapters, 'extras': extras, 'guide': guide_html, 'glossary': glossary, 'architecture': architecture, 'source': source, 'rounds': layout['rounds'], 'pages': layout['pages'], 'editorFields': FIELDS, 'edits': EDITS, 'doubao': doubao}, ensure_ascii=False).replace('<', '\\u003c')
template = (ROOT / 'template.html').read_text(encoding='utf-8')
template = template.replace('__WORKSPACE_STYLE__', (ROOT / 'workspace.css').read_text(encoding='utf-8'))
template = template.replace('__WORKSPACE_SCRIPT__', (ROOT / 'workspace.js').read_text(encoding='utf-8'))
template = template.replace('__EDITOR_SCRIPT__', (ROOT / 'editor.js').read_text(encoding='utf-8'))
template = template.replace('__DOUBAO_SCRIPT__', (ROOT / 'doubao.js').read_text(encoding='utf-8'))
template = template.replace('__STATIC_SITE__', json.dumps(args.static))
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(template.replace('__HANDBOOK_DATA__', payload), encoding='utf-8')
print(f'Generated {args.output.name}: {len(chapters)} chapters, {sum(len(c["questions"]) for c in chapters)} core questions, {len(doubao["questions"])} Doubao questions')
