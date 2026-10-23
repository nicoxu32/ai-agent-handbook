"""Browser regression checks for personal text highlights; requires Playwright."""
import json
from pathlib import Path
import re
import subprocess
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / '_site/index.html').as_uri()
STORAGE = 'nico-agent-handbook-highlights-v1'
SELECT = """({selector,start,end}) => {
 const el=document.querySelector(selector);
 const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
 const range=document.createRange();let offset=0,foundStart=false;
 while(walker.nextNode()){
  const node=walker.currentNode, next=offset+node.length;
  if(!foundStart && start<next){range.setStart(node,start-offset);foundStart=true;}
  if(foundStart && end<=next){range.setEnd(node,end-offset);break;}
  offset=next;
 }
 const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
}"""

def block(key):
    return f'[data-highlight-key="{key}"]'

def select(page, selector, start, end):
    page.locator(selector).evaluate("el=>{el.scrollIntoView({block:'start'});window.scrollBy(0,-170)}")
    page.evaluate(SELECT, {'selector': selector, 'start': start, 'end': end})
    expect(page.locator('.highlight-toolbar')).to_be_visible()

def add(page, selector, start, end):
    text = page.locator(selector).text_content()[start:end]
    select(page, selector, start, end)
    page.locator('.highlight-toolbar [data-selection-action="highlight"]').click()
    expect(page.locator('.highlight-toolbar')).not_to_be_visible()
    assert ''.join(page.locator(selector+' mark').all_text_contents()) == text
    return text

def expect_marks(page, selector, text):
    expect(page.locator(selector+' mark').first).to_be_visible()
    assert ''.join(page.locator(selector+' mark').all_text_contents()) == text

def route(page, target):
    page.evaluate('(r)=>location.hash=r', target)
    page.wait_for_function('(r)=>activeRoute===r', arg=target)

def entries(page):
    return json.loads(page.evaluate('(key)=>localStorage.getItem(key)', STORAGE) or '[]')

def reset(page, target='k01'):
    page.goto(URL+'#'+target)
    page.evaluate('localStorage.clear()')
    page.reload()


def run():
    html=(ROOT/'_site/index.html').read_text()
    script='\n'.join(s for s in re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',html,re.S) if not s.strip().startswith('{'))
    syntax=Path('/tmp/nico-highlight-syntax.js');syntax.write_text(script)
    subprocess.run(['node','--check',str(syntax)],check=True)
    with sync_playwright() as p:
        chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        browser=p.chromium.launch(executable_path=str(chrome) if chrome.exists() else None)
        context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
        page=context.new_page(); errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        reset(page)
        intro=block('chapter/k01/intro')
        original=page.locator(intro).text_content()
        strong_count=page.locator(intro+' strong').count()
        quote=add(page,intro,0,75)
        assert page.locator(intro).text_content()==original
        assert page.locator(intro+' strong').count()==strong_count
        assert len(entries(page))==1
        page.reload()
        expect(page.locator(intro+' mark').first).to_be_visible()
        assert ''.join(page.locator(intro+' mark').all_text_contents())==quote
        route(page,'k02');expect(page.locator('mark.reader-highlight')).to_have_count(0)
        route(page,'k01');expect(page.locator(intro+' mark').first).to_be_visible()
        page.locator('#reading-larger').click()
        assert ''.join(page.locator(intro+' mark').all_text_contents())==quote
        select(page,intro,50,110);page.locator('.highlight-toolbar [data-selection-action="highlight"]').click()
        assert len(entries(page))==1
        assert ''.join(page.locator(intro+' mark').all_text_contents())==original[:110]
        page.locator(intro+' mark').first.click()
        expect(page.locator(intro+' mark')).to_have_count(0)
        page.reload();expect(page.locator(intro+' mark')).to_have_count(0)
        print('PASS: formatting preserved, reload and navigation restore, font changes, overlap merge, click removal persists.')

        # Real pointer selection must work without a script creating the selection.
        page.locator(intro+' p').first.scroll_into_view_if_needed()
        rect=page.locator(intro+' strong').first.bounding_box()
        page.mouse.move(rect['x']+1,rect['y']+rect['height']/2)
        page.mouse.down()
        page.mouse.move(rect['x']+rect['width']-1,rect['y']+rect['height']/2,steps=12)
        page.mouse.up()
        expect(page.locator('.highlight-toolbar')).to_be_visible()
        selected=page.evaluate('getSelection().toString()')
        assert selected.strip()
        page.locator('.highlight-toolbar [data-selection-action="highlight"]').click()
        assert entries(page)[0]['quote']==selected
        reset(page)
        # A multi-paragraph range should remain one removable highlight.
        end=page.locator(intro).evaluate("el=>el.textContent.indexOf(el.querySelectorAll('p')[1].textContent)+20")
        quote=add(page,intro,0,end)
        page.reload()
        assert ''.join(page.locator(intro+' mark').all_text_contents())==quote
        reset(page)
        page.locator('.question-list').scroll_into_view_if_needed()
        page.evaluate("""()=>{
          const titles=document.querySelectorAll('.question summary [data-highlight-key]');
          const range=document.createRange();range.setStart(titles[0].firstChild,0);range.setEnd(titles[1].firstChild,5);
          getSelection().removeAllRanges();getSelection().addRange(range);
        }""")
        expect(page.locator('.highlight-toolbar')).to_be_visible()
        page.locator('.highlight-toolbar [data-selection-action="highlight"]').click()
        assert len(entries(page))==2 and all(item['key'].endswith('/title') for item in entries(page))
        reset(page)
        print('PASS: real mouse drag, multi-paragraph range, cross-question selection excludes collapsed answers.')

        title=block('question/01.1/title');answer=block('question/01.1/answer')
        title_quote=add(page,title,0,8)
        page.locator('.question').first.locator('summary').click()
        answer_quote=add(page,answer,0,30)
        route(page,'bank');expect_marks(page, title, title_quote)
        page.locator('#bank-search').fill('unlikely-query-with-no-match')
        expect(page.locator(title)).to_have_count(0)
        page.locator('#bank-search').fill('')
        expect_marks(page, title, title_quote)
        page.locator('[data-action="practice-question"][data-id="01.1"]').click()
        expect_marks(page, title, title_quote)
        page.locator('[data-action="reveal"]').click()
        assert ''.join(page.locator(answer+' mark').all_text_contents())==answer_quote
        page.locator('[data-action="next-question"]').click()
        expect(page.locator(title)).to_have_count(0)
        page.locator('[data-action="previous-question"]').click()
        expect_marks(page, title, title_quote)
        print('PASS: shared core question title/answer highlights across chapter, filtered bank, practice and question switching.')

        route(page,'doubao')
        question_id=page.locator('.doubao-question').first.get_attribute('data-question-id')
        db_title=block(f'doubao/{question_id}/title')
        db_quote=add(page,db_title,0,10)
        card=page.locator('.doubao-question').first
        assert not card.evaluate('el=>el.open')
        page.locator(db_title+' mark').first.click()
        assert not card.evaluate('el=>el.open')
        add(page,db_title,0,10)
        card.locator('summary').click()
        db_answer=block(f'doubao/{question_id}/answer')
        answer_quote=add(page,db_answer,0,35)
        route(page,question_id)
        expect_marks(page, db_title, db_quote)
        assert ''.join(page.locator(db_answer+' mark').all_text_contents())==answer_quote
        page.locator(db_title+' mark').first.focus();page.keyboard.press('Enter')
        expect(page.locator(db_title+' mark')).to_have_count(0)
        print('PASS: Doubao list/detail share highlights, removal does not toggle summary, keyboard removal works.')

        reset(page)
        quote=add(page,intro,10,40)
        page.locator(intro).evaluate("el=>el.prepend(document.createTextNode('新增说明。'))")
        expect(page.locator(intro+' mark').first).to_be_visible()
        assert ''.join(page.locator(intro+' mark').all_text_contents())==quote
        page.locator(intro).evaluate("el=>el.textContent='原来的这段讲解已经删除。'")
        expect(page.locator(intro+' mark')).to_have_count(0)
        assert len(entries(page))==1
        page.locator(intro).evaluate('(el,text)=>el.textContent=text',original)
        expect(page.locator(intro+' mark').first).to_be_visible()
        # If neither original offsets nor context identify a repeated quote, skip it.
        page.locator(intro).evaluate('(el,quote)=>el.textContent="甲"+quote+"乙"+quote+"丙"',quote)
        expect(page.locator(intro+' mark')).to_have_count(0)
        print('PASS: source insertion reanchors, deleted or ambiguous text is not marked, original text can recover.')

        reset(page)
        page.evaluate("localStorage.setItem('nico-agent-handbook-highlights-v1','invalid-json')")
        page.reload();expect(page.locator(intro+' mark')).to_have_count(0)
        # Persist failures must be visible and must not break in-memory marks.
        page.evaluate("()=>{Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError')}}")
        add(page,intro,0,12)
        expect(page.locator('#toast')).to_contain_text('浏览器无法保存')
        page.reload();expect(page.locator(intro+' mark')).to_have_count(0)
        reset(page)
        # Controls and editor fields must never become annotation targets.
        page.locator('#search').fill('模型')
        page.locator('#search').select_text()
        expect(page.locator('.highlight-toolbar')).not_to_be_visible()
        print('PASS: malformed storage and quota failures handled, input selection ignored.')

        mobile=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,reduced_motion='reduce')
        touch=mobile.new_page();touch.on('pageerror',lambda error:errors.append(str(error)))
        reset(touch)
        select(touch,intro,0,35)
        box=touch.locator('.highlight-toolbar').bounding_box()
        assert box['x']>=0 and box['x']+box['width']<=390
        assert box['y']>650 and box['y']+box['height']<844
        touch.screenshot(path='/tmp/nico-highlights-touch-selection.png')
        touch.locator('.highlight-toolbar [data-selection-action="highlight"]').tap()
        expect(touch.locator(intro+' mark').first).to_be_visible()
        touch.reload();expect(touch.locator(intro+' mark').first).to_be_visible()
        touch.locator(intro+' mark').first.scroll_into_view_if_needed()
        touch.screenshot(path='/tmp/nico-highlights-touch-saved.png')
        touch.locator(intro+' mark').first.tap()
        expect(touch.locator(intro+' mark')).to_have_count(0)
        assert touch.evaluate('document.documentElement.scrollWidth<=innerWidth')
        print('PASS: touch viewport toolbar stays above bottom edge; tap saves/removes; reload restores; no mobile overflow.')
        assert not errors,errors
        browser.close()

if __name__=='__main__':
    run()
