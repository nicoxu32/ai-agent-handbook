"""Verify the reading rail, streaming, insertion and undo in an isolated repository."""
import json
import re
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect
from check_highlights import block, select
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_local_content import copy_project, git

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / '.venv/bin/python'
KEY = 'chapter/k01/intro'
expect.set_options(timeout=25000)


def run():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory) / 'repo';root.mkdir();copy_project(root)
        git(root, 'init', '-b', 'main');git(root, 'config', 'user.email', 'test@example.invalid');git(root, 'config', 'user.name', 'Test')
        git(root, 'add', '.');git(root, 'commit', '-m', 'Fixture');git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
        baseline = git(root, 'rev-parse', 'HEAD')
        document = root / 'content/documents/k01.md';before = document.read_bytes()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0));port = sock.getsockname()[1]
        wrapper = root / 'fake_server.py'
        wrapper.write_text('''import time, server

def model(messages, json_output=True, on_delta=None):
    question = messages[-1]['content']
    if '失败测试' in question:
        on_delta('中断前收到的草稿。')
        raise server.RequestError(502, '模拟连接中断')
    if '取消测试' in question:
        time.sleep(3)
    answer = '先确定资料来源，再判断当前问题。假设企业制度刚刚更新，应检查检索到的版本和引用依据，不能把输入新资料当成重新训练模型。'
    if '只写补充正文' in question:
        answer = '多轮整理后的补充：企业制度更新需要同步索引和权限，回答时引用最新依据，并明确不能确认的部分。'
    if on_delta:
        for start in range(0, len(answer), 12):
            on_delta(answer[start:start+12]);time.sleep(.25)
    return answer
server.request_model = model
server.main()
''')
        process = subprocess.Popen([str(PYTHON), str(wrapper), '--port', str(port)], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        url = f'http://127.0.0.1:{port}'
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(url + '/api/local/status', timeout=1):break
                except OSError:time.sleep(.1)
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
                page = browser.new_page(viewport={'width':1366, 'height':900}, reduced_motion='reduce')
                page.set_default_timeout(20000);errors=[];dialogs=[]
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('dialog', lambda dialog: (dialogs.append(dialog.type), dialog.dismiss()))
                page.route('https://**', lambda route: route.abort())
                page.goto(url + '/#k01')
                select(page, block(KEY), 5, 25);page.locator('[data-selection-action="append"]').click()
                expect(page.locator('.append-editor')).to_be_visible()
                assert page.locator('dialog[open]').count() == 0
                assert page.evaluate('!document.querySelector(".workspace").inert')
                rail = page.locator('.append-editor').bounding_box();reading = page.locator('main').bounding_box()
                assert reading['x'] + reading['width'] <= rail['x'] + 1
                page.locator('#append-question').fill('举个例子');page.locator('#append-ask').click()
                expect(page.locator('.append-partial')).to_contain_text('先确定资料')
                assert page.evaluate('appendState.busy') == 'ask'
                page.evaluate('scrollTo(0,500)');top = page.evaluate('scrollY')
                page.locator('#append-close').click()
                expect(page.locator('.append-editor')).not_to_be_visible()
                assert page.evaluate('appendState.busy') == 'ask'
                page.wait_for_function('!appendState.busy')
                page.locator('.append-toggle').click()
                assert abs(page.evaluate('scrollY') - top) < 3
                expect(page.locator('#append-conversation .assistant')).to_have_count(1)
                assert before == document.read_bytes()
                print('PASS: independent nonmodal rail; live partial text; reading and collapse work during generation; no write before insertion.')
                resize = page.locator('.append-resize');width = rail['width']
                resize.focus();page.keyboard.press('ArrowLeft')
                assert page.locator('.append-editor').bounding_box()['width'] > width
                original_url = page.url
                answer = page.locator('.append-message.assistant textarea').first
                answer.fill('修改过的回答：<script>不执行</script>，先核对资料，再说明边界。')
                page.locator('.append-message.assistant button').first.click()
                expect(page.locator('#append-status')).to_contain_text('已插入原文并保存')
                expect(page.locator(block(KEY) + ' .callout-supplement').last).to_contain_text('修改过的回答：<script>不执行</script>')
                assert page.url == original_url and not dialogs
                assert '修改过的回答' in document.read_text()
                expect(page.locator('#append-conversation .assistant')).to_have_count(1)
                page.locator('#append-undo').click()
                expect(page.locator('#append-status')).to_contain_text('已撤销本次插入')
                assert document.read_bytes() == before, '\n'.join(__import__('difflib').unified_diff(before.decode().splitlines(), document.read_text().splitlines()))
                expect(page.locator('#append-conversation .assistant')).to_have_count(1)
                print('PASS: editable single answer writes the supplement in place; undo restores exact original Markdown; conversation retained; no reload dialog.')
                page.locator('#append-question').fill('再讲一步');page.locator('#append-ask').click();page.wait_for_function('!appendState.busy')
                expect(page.locator('#append-conversation .assistant')).to_have_count(2)
                page.locator('#append-compose').click();page.wait_for_function('!appendState.busy')
                expect(page.locator('#append-input')).to_have_value(re.compile('多轮整理后的补充'))
                page.locator('#append-save').click();expect(page.locator('#append-status')).to_contain_text('已插入原文并保存')
                assert '多轮整理后的补充' in document.read_text()
                page.locator('#append-undo').click();expect(page.locator('#append-status')).to_contain_text('已撤销')
                page.locator('#append-question').fill('失败测试');page.locator('#append-ask').click()
                expect(page.locator('#append-status')).to_contain_text('模拟连接中断')
                expect(page.locator('.append-partial')).to_contain_text('中断前收到的草稿')
                assert page.locator('.append-partial button').count() == 0
                with page.expect_download() as download:
                    page.locator('#append-backup').click()
                saved = Path(directory) / 'followup-draft.txt'
                download.value.save_as(str(saved))
                assert '修改过的回答：<script>不执行</script>' in saved.read_text()
                assert '中断前收到的草稿' in saved.read_text()
                page.reload();select(page, block(KEY), 5, 25);page.locator('[data-selection-action="append"]').click()
                expect(page.locator('.append-partial strong')).to_have_text('未完成的回答 · 仅作草稿')
                assert document.read_bytes() == before, '\n'.join(__import__('difflib').unified_diff(before.decode().splitlines(), document.read_text().splitlines()))
                page.locator('#append-question').fill('取消测试');page.locator('#append-ask').click();page.locator('#append-cancel').click()
                expect(page.locator('#append-status')).to_contain_text('已停止等待')
                expect(page.locator('.append-partial')).to_have_count(0)
                assert document.read_bytes() == before, '\n'.join(__import__('difflib').unified_diff(before.decode().splitlines(), document.read_text().splitlines()))
                print('PASS: multi-turn streaming/composition/insertion; interrupted or canceled answers are kept as drafts and cannot be inserted.')
                page.locator('#append-question').fill('尚未发送的问题')
                page.reload();select(page, block(KEY), 5, 25);page.locator('[data-selection-action="append"]').click()
                expect(page.locator('#append-question')).to_have_value('尚未发送的问题')
                expect(page.locator('#append-conversation .assistant:not(.append-partial)')).to_have_count(2)
                page.evaluate('location.hash="k02"');page.wait_for_function('activeRoute==="k02"')
                page.locator('#append-locate').click();page.wait_for_function('activeRoute==="k01"')
                for width in [1280, 390, 320]:
                    page.set_viewport_size({'width':width, 'height':900});page.evaluate('scrollTo(0,0)')
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    if width <= 760:
                        page.locator('#append-close').click()
                        expect(page.locator('main')).to_be_visible()
                        page.locator('[data-append-view="chat"]').click()
                    page.screenshot(path=f'/tmp/followup-panel-{width}.png')
                print('PASS: draft restoration, source location, 1280px split reading and mobile original/chat switching without overflow.')
                page.set_viewport_size({'width':1366,'height':900})
                path = root/'content/documents/k01.md'
                external = path.read_text()+'\n'
                path.write_text(external)
                page.locator('.append-message.assistant button').first.click()
                expect(page.locator('#append-status')).to_contain_text('原文文件已有更新')
                assert path.read_text() == external
                assert git(root, 'rev-parse', 'HEAD') == baseline
                assert not errors, errors
                print('PASS: external edits cannot be overwritten; no Git commit; no JavaScript errors.')
                browser.close()
        finally:
            process.terminate();process.wait(timeout=10)


if __name__ == '__main__':run()
