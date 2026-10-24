"""Exercise in-place editing against an isolated repository and local server."""
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from content_store import FIELD
from test_local_content import copy_project, git

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / '.venv/bin/python'
KEY = 'chapter/k01/intro'


def focus_end(page):
    page.evaluate('(key)=>editor.instances.get(key).view.commands.focus("end")', KEY)


def select_text(page, text):
    page.evaluate('''({key,text})=>{
      const view=editor.instances.get(key).view;
      let range;
      view.state.doc.descendants((node,pos)=>{
        if(!range && node.isText && node.text.includes(text)) range={from:pos+node.text.indexOf(text),to:pos+node.text.indexOf(text)+text.length};
      });
      if(!range)throw Error('Missing text '+text);
      view.chain().focus().setTextSelection(range).run();
    }''', {'key': KEY, 'text': text})


def run():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)/'repo';root.mkdir();copy_project(root)
        document = root/'content/documents/k01.md'
        source = '### 怎么理解 AI？\n\n可编辑的原始正文。\n下一行保留。\n\n> [!SUPPLEMENT]\n>\n> 原有补充 **解释**。\n\n| 名称 | 说明 |\n| --- | --- |\n| 词元 | 文本单元 |\n\n```python\nprint(1)\n```'
        document.write_text(FIELD.sub(lambda m: f'<!-- field:{m[1]} -->\n{source}\n<!-- /field -->' if m[1]==KEY else m[0], document.read_text()))
        before = dict(FIELD.findall(document.read_text()))
        git(root,'init','-b','main');git(root,'config','user.email','test@example.invalid');git(root,'config','user.name','Test')
        git(root,'add','.');git(root,'commit','-m','Fixture')
        remote=Path(directory)/'remote.git';git(root,'init','--bare',str(remote));git(root,'remote','add','origin',str(remote));git(root,'push','-u','origin','main')
        head=git(root,'rev-parse','HEAD')
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        url=f'http://127.0.0.1:{port}'
        process=subprocess.Popen([str(PYTHON),str(root/'server.py'),'--port',str(port)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(url+'/api/local/status',timeout=1):break
                except OSError:time.sleep(.1)
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
                page=browser.new_page(viewport={'width':1366,'height':900},reduced_motion='reduce')
                page.set_default_timeout(25000);errors=[];reload_dialogs=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.on('dialog',lambda dialog: reload_dialogs.append(dialog.type) if dialog.type == 'beforeunload' else None)
                page.route('https://**',lambda route:route.abort())
                page.goto(url+'/#k01')
                page.locator('[data-action="edit-page"]').click()
                page.wait_for_function('editor.active && editor.ready && !editor.busy')
                expect(page.locator('dialog[open]')).to_have_count(0)
                surface=page.locator(f'[data-field-key="{KEY}"] .document-surface')
                expect(surface.locator('h3')).to_have_text('怎么理解 AI？')
                expect(surface.locator('.callout-supplement')).to_contain_text('原有补充')
                select_text(page,'原始正文');page.locator('[data-editor-format="bold"]').click()
                expect(surface.locator('strong').filter(has_text='原始正文')).to_have_count(1)
                select_text(page,'原始正文');page.locator('[data-editor-format="underline"]').click()
                expect(surface.locator('u').filter(has_text='原始正文')).to_have_count(1)
                focus_end(page);page.keyboard.press('ArrowRight');page.keyboard.press('Enter');page.keyboard.insert_text('页内编辑新增文字。')
                expect(surface).to_contain_text('页内编辑新增文字')
                page.locator('[data-editor-format="undo"]').click();expect(surface).not_to_contain_text('页内编辑新增文字')
                page.locator('[data-editor-format="redo"]').click();expect(surface).to_contain_text('页内编辑新增文字')
                print('PASS: direct text editing, bold, underline, undo/redo; no modal or remote dependency.')
                focus_end(page);page.keyboard.press('Enter');page.locator('[data-editor-format="table"]').click()
                expect(surface.locator('table')).to_have_count(2)
                page.locator('[data-editor-format="addRow"]').click()
                expect(surface.locator('table').last.locator('tr')).to_have_count(4)
                page.locator('[data-editor-format="addColumn"]').click()
                expect(surface.locator('table').last.locator('tr').first.locator('th')).to_have_count(4)
                surface.locator('table').last.locator('th').first.click();page.keyboard.insert_text('新增表头')
                focus_end(page);page.keyboard.press('ArrowDown');page.keyboard.press('Enter')
                image=Path(directory)/'image.png'
                subprocess.run([str(PYTHON),'-c','from PIL import Image;import sys;Image.new("RGB",(600,160),"#dce6d2").save(sys.argv[1])',str(image)],check=True)
                page.once('dialog',lambda dialog:dialog.accept('编辑图片说明'))
                with page.expect_file_chooser() as chooser:page.locator('[data-editor-format="image"]').click()
                chooser.value.set_files(str(image))
                expect(surface.locator('img')).to_have_count(1)
                expect(page.locator('#editor-status')).to_contain_text('图片已插入草稿')
                assert dict(FIELD.findall(document.read_text()))==before
                reload_dialogs.clear()
                with page.expect_navigation():page.locator('#editor-save').click()
                assert reload_dialogs == []
                page.wait_for_function('editor.active && editor.ready && !editor.busy')
                expect(page.locator('#editor-status')).to_contain_text('已保存到本地')
                page.locator('#editor-close').click()
                expect(page.locator('body')).not_to_have_class('document-editing')
                read=page.locator(f'[data-highlight-key="{KEY}"]')
                expect(read).to_contain_text('页内编辑新增文字')
                expect(read.locator('.callout-supplement')).to_contain_text('原有补充')
                expect(read.locator('table')).to_have_count(2)
                expect(read.locator('img')).to_have_attribute('alt','编辑图片说明')
                after=dict(FIELD.findall(document.read_text()))
                for key,value in before.items():
                    if key!=KEY:assert after[key]==value,key
                assert '> [!SUPPLEMENT]' in after[KEY] and '../images/' in after[KEY] and '```python' in after[KEY]
                assert git(root,'rev-parse','HEAD')==head and git(root,'rev-parse','origin/main')==head
                print('PASS: tables and local images edit in place; Markdown save preserves callouts, code and all untouched fields; Git unchanged.')
                page.locator('[data-action="edit-page"]').click();page.wait_for_function('editor.ready && !editor.busy')
                focus_end(page);page.keyboard.press('Enter');page.keyboard.insert_text('尚未保存的草稿。')
                page.locator('#editor-close').click();expect(read).not_to_contain_text('尚未保存的草稿')
                page.locator('[data-action="edit-page"]').click();page.wait_for_function('editor.ready && !editor.busy')
                expect(surface).to_contain_text('尚未保存的草稿')
                page.evaluate('location.hash="k02"');expect(page.locator('.lesson-subtitle')).to_contain_text('长对话')
                page.evaluate('location.hash="k01"');expect(page.locator('.lesson-subtitle')).to_contain_text('AI')
                page.locator('[data-action="edit-page"]').click();page.wait_for_function('editor.ready && !editor.busy')
                expect(surface).to_contain_text('尚未保存的草稿')
                page.reload();page.locator('[data-action="edit-page"]').click();page.wait_for_function('editor.ready && !editor.busy')
                expect(surface).to_contain_text('尚未保存的草稿')
                external=document.read_text().replace('页内编辑新增文字。','外部编辑器修改的文字。')
                document.write_text(external)
                page.locator('#editor-save').click();expect(page.locator('#editor-status')).to_contain_text('其他窗口')
                assert document.read_text()==external
                expect(surface).to_contain_text('尚未保存的草稿')
                with page.expect_download() as download:page.locator('#editor-export').click()
                download.value.save_as(str(Path(directory)/'draft.md'))
                assert '尚未保存的草稿' in (Path(directory)/'draft.md').read_text()
                page.once('dialog',lambda dialog:dialog.accept())
                page.locator('#editor-reload').click();page.wait_for_function('editor.ready && !editor.busy')
                expect(surface).to_contain_text('外部编辑器修改的文字')
                expect(surface).not_to_contain_text('尚未保存的草稿')
                print('PASS: draft recovery across exit, navigation and refresh; external changes are never overwritten; backup and reload work.')
                page.screenshot(path='/tmp/inline-editor-desktop.png',full_page=False)
                page.set_viewport_size({'width':390,'height':844});page.evaluate('scrollTo(0,0)')
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
                page.screenshot(path='/tmp/inline-editor-mobile.png',full_page=False)
                page.locator('#editor-close').click();page.evaluate('location.hash="home"')
                expect(page.locator('.path-card')).to_have_count(3)
                page.locator('[data-action="edit-page"]').click();page.wait_for_function('editor.ready && !editor.busy')
                expect(page.locator('[data-field-key="round/0/title"]')).to_have_attribute('contenteditable','plaintext-only')
                page.locator('#editor-close').click();page.evaluate('location.hash="db-tech-01"')
                page.locator('[data-action="edit-page"]').click();page.wait_for_function('editor.ready && !editor.busy')
                expect(page.locator('[data-field-key="doubao/db-tech-01/answer"] .document-surface')).to_have_count(1)
                assert not errors,errors
                print('PASS: mobile 390px, overview and Doubao editing; no JavaScript errors.')
                browser.close()
        finally:
            process.terminate();process.wait(timeout=10)


if __name__=='__main__':run()
