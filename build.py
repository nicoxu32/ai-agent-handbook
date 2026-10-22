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

def render(text):
    text = re.sub(r'<a id="k\d+"></a>', '', text)
    diagram = '''<div class="flow" role="img" aria-label="任务流程：用户目标经过权限和状态确认，工作流或智能体调用知识、工具和多模态能力，核验并交付结果；日志、评测和版本记录贯穿各步骤。"><div>用户目标与业务约束</div><span>↓</span><div>身份权限 · 任务状态 · 范围确认</div><span>↓</span><div>工作流 / Agent 选择下一步</div><span>↓</span><div class="flow-branches"><div>知识与检索</div><div>工具与接口</div><div>多模态理解</div></div><span>↓</span><div>模型处理 → 事实与授权检查 → 必要时人工确认</div><span>↓</span><div>核验真实执行状态 → 继续任务或交付结果</div><small>日志 · 评测 · 成本 · 版本记录贯穿全过程</small></div>'''
    text = re.sub(r'```mermaid\n.*?```', lambda _: diagram, text, flags=re.S)
    html = markdown.markdown(text, extensions=['tables', 'fenced_code'])
    soup = BeautifulSoup(html, 'html.parser')
    for a in soup.find_all('a', href=True):
        if a['href'].startswith('https://'):
            a['target'] = '_blank'
            a['rel'] = 'noopener noreferrer'
        elif a['href'].startswith('/Users/'):
            a['href'] = '../' + Path(a['href']).name
    for table in soup.find_all('table'):
        wrapper = soup.new_tag('div', attrs={'class': 'table-scroll', 'tabindex': '0', 'aria-label': '可横向滚动的表格'})
        table.wrap(wrapper)
    return str(soup)

source = SOURCE.read_text(encoding='utf-8')
chapters = []
for match in re.finditer(r'^### (\d{2})｜(.+?)〔(P[012])〕\n(.*?)(?=^### \d{2}｜|^## |\Z)', source, re.M | re.S):
    number, title, priority, body = match.groups()
    intro = body.split('**先这样理解**', 1)[1].split('**放到产品里怎么判断**', 1)[0]
    decision = body.split('**放到产品里怎么判断**', 1)[1].split('**面试题 ', 1)[0]
    questions = []
    for question in re.finditer(r'\*\*面试题 (\d{2}\.[123])｜(.+?)\*\*\s*\*\*口述答案：\*\*(.*?)(?=\*\*面试题 |<a id=|\Z)', body, re.S):
        qid, question_title, answer = question.groups()
        questions.append({'id': qid, 'title': question_title, 'answer': render(answer.strip())})
    group = next(i for i, bound in enumerate(BOUNDS) if int(number) <= bound)
    chapters.append({'id': 'k' + number, 'number': number, 'title': title, 'short': title.split('：')[0], 'priority': priority, 'group': group, 'intro': render(intro), 'decision': render(decision), 'questions': questions, 'search': title + '\n' + body})
intro = source.split('## 先说这份手册怎么用', 1)[1].split('## 一、模型基础', 1)[0]
appendix = source.split('## 七、', 1)[1]
metadata = source.split('\n', 1)[1].split('## 先说这份手册怎么用', 1)[0]
guide_html = render('## 先说这份手册怎么用' + intro.split('## 学习顺序与目录', 1)[0])
extras = [{'id': 'guide', 'title': '阅读指南与学习顺序', 'html': render(metadata + '## 先说这份手册怎么用' + intro)}]
for i, match in enumerate(re.finditer(r'^## (.+?)\n(.*?)(?=^## |\Z)', '## 七、' + appendix, re.M | re.S)):
    extras.append({'id': 'extra' + str(i), 'title': match.group(1).split('、', 1)[-1], 'html': render(match.group(0))})
if len(chapters) != 36 or any(len(c['questions']) != 3 for c in chapters):
    raise ValueError('Source must contain 36 chapters and three questions per chapter')
glossary = []
glossary_source = source.split('## 十、常用术语速查', 1)[1].split('## 十一、', 1)[0]
for line in glossary_source.splitlines():
    if line.startswith('|'):
        cells = [cell.strip() for cell in line.strip('|').split('|')]
        if len(cells) == 3 and re.search(r'\d{2}', cells[2]):
            glossary.append({'term': cells[0], 'explanation': cells[1], 'chapters': re.findall(r'\d{2}', cells[2])})
architecture = json.loads((ROOT / 'architecture.json').read_text(encoding='utf-8'))
linked_ids = {number for node in architecture['nodes'] for number in node['chapters']}
if linked_ids != set(range(1, 37)):
    raise ValueError('Architecture must link all 36 knowledge points')
payload = json.dumps({'groups': GROUPS, 'chapters': chapters, 'extras': extras, 'guide': guide_html, 'glossary': glossary, 'architecture': architecture, 'source': source}, ensure_ascii=False).replace('<', '\\u003c')
template = (ROOT / 'template.html').read_text(encoding='utf-8')
template = template.replace('__WORKSPACE_STYLE__', (ROOT / 'workspace.css').read_text(encoding='utf-8'))
template = template.replace('__WORKSPACE_SCRIPT__', (ROOT / 'workspace.js').read_text(encoding='utf-8'))
template = template.replace('__STATIC_SITE__', json.dumps(args.static))
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(template.replace('__HANDBOOK_DATA__', payload), encoding='utf-8')
print(f'Generated {args.output.name}: {len(chapters)} chapters, {sum(len(c["questions"]) for c in chapters)} questions, {len(extras)} reading supplements')
