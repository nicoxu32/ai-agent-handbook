"""Exercise selection formatting, image editing and publishing in an isolated repo."""
import json
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
from content_store import FIELD
from test_local_content import copy_project, git

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / '.venv/bin/python'


def run():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory) / 'repo'
        root.mkdir()
        copy_project(root)
        document = root / 'content/documents/k01.md'
        source = '> [!KEY]\n>\n> 核心结论：先找证据，再生成答案。\n\n### 怎么落地\n\n先保证证据完整，再核对权限，使用 source_id（来源标识）记录出处。\n\n解析资料。\n\n建立索引。\n\n切分方式需要实测，保留适用条件。\n\n> 口述示范：先说明判断，再举例。\n\n> [!TIP]\n>\n> 不要用缺乏依据的结论替代原文。'
        document.write_text(FIELD.sub(lambda match: f'<!-- field:{match[1]} -->\n{source}\n<!-- /field -->' if match[1] == 'chapter/k01/intro' else match[0], document.read_text()))
        git(root, 'init', '-b', 'main')
        git(root, 'config', 'user.email', 'test@example.invalid')
        git(root, 'config', 'user.name', 'Test')
        git(root, 'add', '.')
        git(root, 'commit', '-m', 'Fixture')
        remote = Path(directory) / 'remote.git'
        git(root, 'init', '--bare', str(remote))
        git(root, 'remote', 'add', 'origin', str(remote))
        git(root, 'push', '-u', 'origin', 'main')
        baseline = git(root, 'rev-parse', 'HEAD')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        url = f'http://127.0.0.1:{port}'
        process = subprocess.Popen([str(PYTHON), str(root/'server.py'), '--port', str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(url+'/api/local/status', timeout=1):
                        break
                except OSError:
                    time.sleep(.1)
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
                page = browser.new_page(viewport={'width':1366, 'height':900}, reduced_motion='reduce')
                page.set_default_timeout(20000)
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.route('https://**', lambda route: route.abort())
                page.goto(url+'/#k01')
                selector = block('chapter/k01/intro')
                for style, text, expected_selector in [
                    ('bold', '证据完整', 'strong'), ('code', 'source_id', 'code'),
                    ('underline', '核对权限', 'u'), ('number', '解析资料。\n建立索引。', 'ol'),
                    ('block', '切分方式需要实测', '.callout-note')]:
                    visible = page.locator(selector).text_content()
                    start = visible.index(text)
                    select(page, selector, start, start+len(text))
                    assert page.locator('.highlight-toolbar [data-editor-format="image"]').count() == 0
                    with page.expect_navigation():
                        page.locator(f'[data-selection-style="{style}"]').click()
                    expect(page.locator(selector+' '+expected_selector).filter(has_text=text.split('\n')[0]).first).to_be_visible()
                    assert git(root, 'rev-parse', 'HEAD') == baseline
                print('PASS: bold, inline code, underline, numbering and standalone blocks save to local Markdown and immediately render; no Git commit.')

                # The original highlight action must still work inside formatted blocks.
                visible = page.locator(selector).text_content()
                start = visible.index('证据完整')
                select(page, selector, start, start+4)
                page.locator('[data-selection-action="highlight"]').click()
                expect(page.locator(selector+' mark')).to_contain_text('证据完整')
                page.reload()
                expect(page.locator(selector+' mark')).to_contain_text('证据完整')
                print('PASS: persistent highlights still restore inside formatted text.')

                page.locator('[data-action="edit-page"]').click()
                page.wait_for_function('editor.active && editor.ready && !editor.busy')
                field = page.locator('[data-field-key="chapter/k01/intro"]')
                page.evaluate('editor.instances.get("chapter/k01/intro").view.commands.focus("end")')
                image_file = Path(directory) / 'diagram.png'
                subprocess.run([str(PYTHON), '-c', 'from PIL import Image; import sys; Image.new("RGB",(960,320),"#dce8d4").save(sys.argv[1])', str(image_file)], check=True)
                page.once('dialog', lambda dialog: dialog.accept('检索到生成：流程示意'))
                with page.expect_file_chooser() as chooser:
                    page.locator('[data-editor-format="image"]').click()
                chooser.value.set_files(str(image_file))
                expect(page.locator('#editor-status')).to_contain_text('图片已插入草稿')
                assert 'media/' in field.locator('img').get_attribute('src')
                assert '检索到生成' not in document.read_text()
                with page.expect_navigation():
                    page.locator('#editor-save').click()
                page.wait_for_function('editor.active && editor.ready && !editor.busy')
                page.locator('#editor-close').click()
                image = page.locator(selector+' img.reading-image')
                expect(image).to_be_visible()
                image.evaluate('el=>el.scrollIntoView()')
                page.wait_for_function('document.querySelector("main img.reading-image").naturalWidth === 960')
                assert 'media/' in image.get_attribute('src')
                image.click()
                expect(page.locator('.image-viewer')).to_be_visible()
                expect(page.locator('.image-viewer p')).to_have_text('检索到生成：流程示意')
                page.keyboard.press('Escape')
                expect(page.locator('.image-viewer')).not_to_be_visible()
                print('PASS: image insertion exists only in the editor; upload stays a draft until save; local image loads, has a caption, and opens in a dismissible viewer.')

                for width in [1366, 390, 320]:
                    page.set_viewport_size({'width':width, 'height':900})
                    page.evaluate('scrollTo(0,0)')
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                    page.screenshot(path=f'/tmp/reading-formats-{width}.png')
                    text = page.locator(selector).text_content()
                    start = text.index('证据完整')
                    select(page, selector, start, start+4)
                    bounds = page.locator('.highlight-toolbar').bounding_box()
                    assert bounds['x'] >= 0 and bounds['x']+bounds['width'] <= width
                    assert page.locator('.highlight-toolbar button:visible').evaluate_all('buttons=>buttons.every(button=>{const r=button.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("button")===button})')
                    page.screenshot(path=f'/tmp/reading-toolbar-{width}.png')
                    page.keyboard.press('Escape')
                print('PASS: reading layout, image and selection toolbar fit 1366, 390 and 320 pixel screens.')

                # Keep externally saved changes if the selection's revision is stale.
                text = page.locator(selector).text_content()
                start = text.index('切分方式需要实测')
                select(page, selector, start, start+8)
                external = document.read_text().replace('切分方式需要实测', '外部修改需要保留')
                document.write_text(external)
                page.locator('[data-selection-style="underline"]').click()
                expect(page.locator('#toast')).to_contain_text('原文已被其他窗口修改')
                assert document.read_text() == external
                page.reload()
                page.locator('#publish-content').click()
                expect(page.locator('#publish-status')).to_contain_text('已同步，等待网站部署', timeout=45000)
                changed = git(root, 'diff', '--name-only', baseline, 'HEAD').splitlines()
                assert 'content/documents/k01.md' in changed
                assert any(name.startswith('content/images/') for name in changed)
                assert git(root, 'rev-parse', 'HEAD') == git(root, 'rev-parse', 'origin/main')
                subprocess.run([str(PYTHON), str(root/'build.py'), '--static', '--output', str(root/'_site/index.html')], check=True, stdout=subprocess.DEVNULL)
                assert list((root/'_site/media').glob('*.jpg'))
                page.goto((root/'_site/index.html').as_uri()+'#k01')
                expect(page.locator('#publish-content')).to_be_hidden()
                static_image = page.locator(selector+' img.reading-image')
                static_image.evaluate('el=>el.scrollIntoView()')
                page.wait_for_function('document.querySelector("main img.reading-image").naturalWidth === 960')
                text = page.locator(selector).text_content()
                start = text.index('证据完整')
                select(page, selector, start, start+4)
                expect(page.locator('[data-selection-style="bold"]')).to_be_hidden()
                print('PASS: stale formatting cannot overwrite external edits; manual publish includes images and Markdown; static reader loads images and hides editing actions.')
                assert not errors, errors
                browser.close()
        finally:
            process.terminate()
            process.wait(timeout=5)


if __name__ == '__main__':
    run()
