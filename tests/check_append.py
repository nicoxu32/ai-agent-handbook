"""Browser checks against an isolated local server; never edit the user's files."""
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import sys
import urllib.request
from playwright.sync_api import sync_playwright, expect
from check_highlights import block, select
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_local_content import copy_project, git

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / '.venv/bin/python'


def run():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        copy_project(root)
        git(root, 'init', '-b', 'main')
        git(root, 'config', 'user.email', 'test@example.invalid')
        git(root, 'config', 'user.name', 'Test')
        git(root, 'add', '.')
        git(root, 'commit', '-m', 'Fixture')
        git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        url = f'http://127.0.0.1:{port}'
        process = subprocess.Popen([str(PYTHON), str(root/'server.py'), '--port', str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:
                    urllib.request.urlopen(url+'/api/local/status', timeout=1)
                    break
                except OSError:
                    time.sleep(.1)
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
                page = browser.new_page(viewport={'width':1366,'height':900}, reduced_motion='reduce')
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                # Block all external network requests: local editing must still work.
                page.route('https://**', lambda route: route.abort())
                page.goto(url+'/#k01')
                expect(page.locator('.topbar #publish-content')).to_be_visible()
                assert page.locator('.content-editor #editor-publish').count() == 0
                opened = []
                def open_file(route):
                    opened.append(route.request.post_data_json)
                    route.fulfill(json={'opened':True, 'path':'content/documents/k01.md'})
                page.route('**/api/local/open-document', open_file)
                key = 'chapter/k01/intro'
                original_head = git(root, 'rev-parse', 'HEAD')
                page.locator('[data-action="edit-page"]').click()
                expect(page.locator('#editor-status')).to_contain_text('已读取')
                page.locator('#editor-open-file').click()
                expect(page.locator('#editor-status')).to_contain_text('已请求文本编辑器')
                assert opened == [{'group':'k01'}]
                source = page.locator(f'[data-field-key="{key}"]').input_value()
                new_text = source+'\n\n离线保存测试。\n换行即时可见。'
                page.locator(f'[data-field-key="{key}"]').fill(new_text)
                expect(page.locator('#editor-open-file')).to_be_disabled()
                page.locator('#editor-close').click()
                page.reload()
                page.locator('[data-action="edit-page"]').click()
                expect(page.locator('#editor-status')).to_contain_text('已恢复未保存草稿')
                expect(page.locator(f'[data-field-key="{key}"]')).to_have_value(new_text)
                with page.expect_navigation():
                    page.locator('#editor-save').click()
                expect(page.locator(block(key))).to_contain_text('离线保存测试')
                assert '离线保存测试' in (root/'content/documents/k01.md').read_text()
                assert git(root, 'rev-parse', 'HEAD') == original_head
                page.reload()
                expect(page.locator(block(key))).to_contain_text('离线保存测试')
                print('PASS: external network blocked; draft survives reload; save writes disk and immediately updates reading without Git commit.')

                select(page, block(key), 6, 22)
                page.locator('[data-selection-action="append"]').click()
                page.locator('#append-input').fill('本地追加 😀 <script>不会执行</script>。')
                with page.expect_navigation():
                    page.locator('#append-save').click()
                expect(page.locator(block(key))).to_contain_text('本地追加 😀 <script>不会执行</script>。')
                assert page.locator(block(key)+' script').count()==0
                print('PASS: append writes the same Markdown document and is visible immediately; markup remains literal.')

                page.locator('[data-action="edit-page"]').click()
                expect(page.locator('#editor-status')).to_contain_text('已读取')
                page.locator(f'[data-field-key="{key}"]').fill('不应覆盖外部修改。')
                path = root/'content/documents/k01.md'
                external = path.read_text().replace('离线保存测试', '外部编辑器的新内容')
                path.write_text(external)
                page.locator('#editor-save').click()
                expect(page.locator('#editor-status')).to_contain_text('文件已被其他窗口')
                assert path.read_text() == external
                expect(page.locator(f'[data-field-key="{key}"]')).to_have_value('不应覆盖外部修改。')
                page.locator('#editor-close').click()
                page.reload()
                expect(page.locator(block(key))).to_contain_text('外部编辑器的新内容')
                print('PASS: external edits show on refresh; stale save rejected and browser draft retained.')

                for width in [1366,390,320]:
                    page.set_viewport_size({'width':width,'height':900})
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                    page.locator('[data-action="edit-page"]').click()
                    expect(page.locator('#editor-status')).to_contain_text('已恢复')
                    header = page.locator('.content-editor:not(.append-editor) .editor-heading').bounding_box()
                    footer = page.locator('.content-editor:not(.append-editor) .editor-footer').bounding_box()
                    page.locator('.content-editor:not(.append-editor) .editor-body').evaluate('el=>el.scrollTop=el.scrollHeight')
                    assert page.locator('.content-editor:not(.append-editor) .editor-heading').bounding_box()==header
                    assert page.locator('.content-editor:not(.append-editor) .editor-footer').bounding_box()==footer
                    assert footer['x']>=0 and footer['x']+footer['width']<=width
                    page.screenshot(path=f'/tmp/local-editor-{width}.png')
                    page.locator('#editor-close').click()
                published = []
                def publish(route):
                    published.append(route.request.post_data_json)
                    route.fulfill(json={'published':True, 'pending':0, 'unpushed':0})
                page.route('**/api/local/publish', publish)
                page.locator('#publish-content').click()
                expect(page.locator('#publish-status')).to_contain_text('已同步，等待网站部署')
                assert published == [{}]
                assert page.locator('#publish-status a').get_attribute('href').endswith('/actions')
                print('PASS: footer opens selected Markdown; dirty draft blocks external opening; publishing is global.')
                assert not errors, errors
                browser.close()
                print('PASS: desktop and mobile editor fits viewport; heading and local save controls fixed.')
        finally:
            process.terminate()
            process.wait(timeout=5)


if __name__ == '__main__':
    run()
