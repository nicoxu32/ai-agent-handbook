"""Append new interview questions from a public Doubao share without replacing edits."""

import argparse
from copy import deepcopy
from datetime import date
import json
import os
from pathlib import Path
import re
import tempfile
import sys
import unicodedata
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from content_store import add_documents

SOURCE_URL = 'https://www.doubao.com/thread/xVhxnbH6JuZhEG6sc'
QUESTION_FILE = ROOT / 'content/doubao-interviews.json'


def normalized_title(title):
    return re.sub(r'[\W_]+', '', unicodedata.normalize('NFKC', title)).casefold()


def read_snapshot(html):
    soup = BeautifulSoup(html, 'html.parser')
    for script in soup.select('script[data-fn-args]'):
        arguments = json.loads(script['data-fn-args'])
        if arguments[0] != 'thread_(token)/page':
            continue
        payload = None
        if arguments[1] == 'shareInfo' and len(arguments) >= 3:
            payload = arguments[2]
        elif isinstance(arguments[1], list):
            for entry in arguments[1]:
                if entry.get('key') == 'shareInfo' and entry.get('routerDataFnName') == 'p':
                    payload = json.loads(entry['routerDataFnArgs'][0])
        if not isinstance(payload, dict) or 'data' not in payload:
            continue
        data = payload['data']
        messages = data['message_snapshot']['message_list']
        end = int(data['share_info']['message_index_end'])
        if not messages or max(int(m['index_in_conv']) for m in messages) < end:
            raise ValueError('Share snapshot is incomplete; no questions were written')
        return messages, end
    raise ValueError('Public share data is unavailable or its format changed')


def parse_questions(messages):
    questions = []
    for message in messages:
        if message['user_type'] != 2:
            continue
        text = '\n'.join(
            block.get('content', {}).get('text_block', {}).get('text', '')
            for block in message.get('content_block', []) if block.get('block_type') == 10000
        )
        parsed = []
        if '**口述参考答案：**' in text:
            headings = list(re.finditer(r'^## 题目[一二]｜([^\n]+)\n', text, re.M))
            if len(headings) != text.count('**口述参考答案：**'):
                raise ValueError(f"Question format changed in message {message['message_id']}")
            for index, heading in enumerate(headings):
                end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
                section = text[heading.end():end].split('\n\n---', 1)[0]
                label = heading.group(1).replace(' ', '')
                if '产品经理' in label:
                    category = 'pm'
                elif '技术' in label:
                    category = 'tech'
                else:
                    raise ValueError(f'Unknown interview category: {label}')
                title, rest = section.split('**题干：**', 1)[1].split('**框架：**', 1)
                framework, answer = rest.split('**口述参考答案：**', 1)
                parsed.append((category, title, framework, answer))
        elif '**参考答案（面试者口述视角）：**' in text:
            sections = re.split(r'\*\*题目[一二]（[^\n]+）\*\*', text)[1:]
            if not sections:
                sections = [text]
            if len(sections) != text.count('**参考答案（面试者口述视角）：**'):
                raise ValueError('Incomplete legacy question format')
            for index, section in enumerate(sections):
                title = re.search(r'^> (.+)', section, re.M).group(1)
                answer = section.split('**参考答案（面试者口述视角）：**', 1)[1].split('\n\n---', 1)[0]
                parsed.append(('pm' if index == 0 else 'tech', title, '', answer))
        elif re.search(r'^## 题目', text, re.M) and '### 🟡' not in text:
            raise ValueError('Interview heading found without a supported complete answer')
        for category, title, framework, answer in parsed:
            title = title.replace('**', '').strip()
            answer = answer.strip()
            if not 5 <= len(title) <= 300 or not 80 <= len(answer) <= 40000:
                raise ValueError('Incomplete or oversized question; no questions were written')
            questions.append({
                'category': category, 'title': title, 'framework': framework.strip(),
                'answer': answer, 'supplement': '',
                'sourceMessage': int(message['index_in_conv']),
                'sourceMessageId': message['message_id'],
            })
    if not questions:
        raise ValueError('No complete interview questions found')
    return questions


def merge_questions(original, incoming, source_url):
    result = deepcopy(original)
    by_title = {(q['category'], normalized_title(q['title'])): q for q in result['questions']}
    by_message = {(q.get('sourceMessageId'), q['category']): q for q in result['questions'] if q.get('sourceMessageId')}
    added, revisions = [], []
    for question in incoming:
        key = (question['category'], normalized_title(question['title']))
        existing = by_message.get((question['sourceMessageId'], question['category'])) or by_title.get(key)
        if existing:
            if existing['answer'].strip() != question['answer'] or existing['title'] != question['title']:
                revisions.append(existing['id'])
            continue
        category = question['category']
        number = max((int(q['id'].rsplit('-', 1)[1]) for q in result['questions'] if q['category'] == category), default=0) + 1
        item = {**question, 'id': f'db-{category}-{number:02d}', 'sourceUrl': source_url, 'importedOn': date.today().isoformat()}
        result['questions'].append(item)
        by_title[key] = item
        by_message[(item['sourceMessageId'], category)] = item
        added.append(item['id'])
    if added:
        result['sources'] = list(dict.fromkeys([*result.get('sources', [result['sourceUrl']]), source_url]))
    return result, added, sorted(set(revisions))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-url', default=SOURCE_URL)
    parser.add_argument('--html', type=Path, help='Read an already downloaded share for review or testing')
    parser.add_argument('--apply', action='store_true', help='Append new questions; default is a read-only preview')
    args = parser.parse_args()
    if not re.fullmatch(r'https://www\.doubao\.com/thread/[A-Za-z0-9]+', args.source_url):
        raise ValueError('Expected a public Doubao thread URL')
    if args.html:
        html = args.html.read_text(encoding='utf-8')
    else:
        request = Request(args.source_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urlopen(request, timeout=40) as response:
            raw = response.read(10_000_001)
        if len(raw) > 10_000_000:
            raise ValueError('Share page exceeds the size limit')
        html = raw.decode('utf-8')
    messages, end = read_snapshot(html)
    incoming = parse_questions(messages)
    original = json.loads(QUESTION_FILE.read_text(encoding='utf-8'))
    result, added, revisions = merge_questions(original, incoming, args.source_url)
    if args.apply and added:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=QUESTION_FILE.parent, delete=False) as temporary:
            json.dump(result, temporary, ensure_ascii=False, indent=2)
            temporary.write('\n')
        # New questions get their own editable Markdown documents immediately.
        groups = []
        for question in result['questions']:
            if question['id'] not in added:
                continue
            fields, values = [], {}
            for name, label in [('title', '面试题'), ('framework', '回答框架'), ('answer', '口述参考答案'), ('supplement', '原文补充')]:
                if not question[name]:
                    continue
                key = f"doubao/{question['id']}/{name}"
                fields.append({'key': key, 'label': label, 'multiline': name != 'title'})
                values[key] = question[name]
            groups.append((question['id'], question['title'], fields, values))
        add_documents(QUESTION_FILE.parent, groups)
        os.replace(temporary.name, QUESTION_FILE)
    print(json.dumps({
        'source': args.source_url, 'snapshotEnd': end, 'sourceQuestions': len(incoming),
        'added': added, 'existingAnswerChangesForReview': revisions,
        'total': len(result['questions']), 'applied': bool(args.apply and added),
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
