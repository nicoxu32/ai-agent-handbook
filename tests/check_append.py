"""Exercise selection append and shared editor with mocked GitHub responses only."""
import base64
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from check_highlights import URL, block, select, reset, route

KEY = 'chapter/k01/intro'
INTRO = block(KEY)
TOKEN = 'test-authorization-placeholder'


class GitHubMock:
    def __init__(self, page):
        self.page = page
        self.value = page.evaluate('DATA.edits')
        self.sha = 'initial-version'
        self.source_sha = page.evaluate('DATA.handbookSourceSha')
        self.puts = []
        self.failure = None
        self.permission = True
        page.route('https://api.github.com/**', self.handle)

    def handle(self, route):
        request = route.request
        if request.method == 'PUT':
            body = request.post_data_json
            self.puts.append(body)
            if self.failure in [403, 409]:
                route.fulfill(status=self.failure, json={'message': 'Simulated failure'})
                return
            if self.failure == 'network':
                route.abort()
                return
            assert body['sha'] == self.sha
            self.value = json.loads(base64.b64decode(body['content']))
            self.sha = 'updated-version'
            if self.failure == 'lost-response':
                route.abort()
                return
            route.fulfill(json={'content': {'sha': self.sha}})
        elif '/contents/content/edits.json' in request.url:
            content = base64.b64encode(json.dumps(self.value, ensure_ascii=False).encode()).decode()
            route.fulfill(json={'encoding': 'base64', 'content': content, 'sha': self.sha})
        elif '/contents/content/handbook.md' in request.url:
            route.fulfill(json={'sha': self.source_sha})
        else:
            route.fulfill(json={'full_name': 'nicoxu32/ai-agent-handbook', 'permissions': {'push': self.permission}})


def open_append(page, selector=INTRO, start=6, end=22):
    select(page, selector, start, end)
    page.locator('[data-selection-action="append"]').click()
    expect(page.locator('.append-editor')).to_be_visible()


def connect(page):
    page.locator('#append-token').fill(TOKEN)
    page.locator('#append-connect').click()
    expect(page.locator('#append-auth-state')).to_contain_text('已连接')


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        context = browser.new_context(viewport={'width': 1366, 'height': 900}, reduced_motion='reduce')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        reset(page)
        api = GitHubMock(page)
        open_append(page)
        target = page.evaluate('appendState.target')
        addition = '补充 😀：RAG 要先验证召回证据。\n\n<script>alert(1)</script> 和 **星号** 是原样文字。'
        page.locator('#append-input').fill(addition)
        expect(page.locator('#append-preview-text')).to_have_text(addition)
        assert page.locator('#append-preview-text script').count() == 0
        page.locator('#append-close').click()
        page.reload()
        open_append(page)
        expect(page.locator('#append-input')).to_have_value(addition)
        page.locator('#append-save').click()
        expect(page.locator('#append-status')).to_contain_text('请先连接')
        assert not api.puts
        connect(page)
        api.value['chapter/k02/intro'] = '其他设备刚刚保存的内容。'
        page.evaluate("editor.draft['chapter/k03/intro']='普通编辑器尚未发布的草稿';editor.dirty=true")
        page.locator('#append-save').click()
        expect(page.locator('#append-status')).to_contain_text('补充内容已保存')
        assert len(api.puts) == 1
        saved = api.value[KEY]
        before = target['source'].encode('utf-16-le')[:target['end']*2].decode('utf-16-le').rstrip('\n')
        after = target['source'].encode('utf-16-le')[target['end']*2:].decode('utf-16-le').lstrip('\n')
        assert saved.startswith(before+'\n\n补充 😀：')
        assert saved.endswith(after)
        assert '\\<script\\>' in saved
        assert api.value['chapter/k02/intro'] == '其他设备刚刚保存的内容。'
        assert api.value.get('chapter/k03/intro') != '普通编辑器尚未发布的草稿'
        assert TOKEN not in page.evaluate('JSON.stringify(localStorage)')
        expect(page.locator('#append-save')).to_be_disabled()
        assert not json.loads(page.evaluate("localStorage.getItem('nico-handbook-append-drafts-v1')"))
        print('PASS: paragraph-end placement, safe preview, draft reload, authorization, isolated write, remote edits preserved, duplicate save disabled.')

        for failure in ['field-changed', 'source-changed', 403, 409, 'network', 'lost-response']:
            page.unroute('https://api.github.com/**')
            reset(page)
            api = GitHubMock(page)
            open_append(page)
            page.locator('#append-input').fill('保留这份追加草稿。')
            connect(page)
            if failure == 'field-changed':
                api.value[KEY] = '远端已经变更的当前段落。'
            elif failure == 'source-changed':
                api.source_sha = 'new-source'
            else:
                api.failure = failure
            page.locator('#append-save').click()
            if failure == 'lost-response':
                expect(page.locator('#append-status')).to_contain_text('补充内容已保存')
                assert len(api.puts) == 1
                expect(page.locator('#append-save')).to_be_disabled()
            else:
                expect(page.locator('#append-status')).to_have_class('error')
                expect(page.locator('#append-input')).to_have_value('保留这份追加草稿。')
                assert json.loads(page.evaluate("localStorage.getItem('nico-handbook-append-drafts-v1')"))
                if failure in ['field-changed', 'source-changed']:
                    assert not api.puts
        print('PASS: field/source conflicts, forbidden, concurrent PUT, network failures preserve draft; lost successful response confirmed without repeat write.')

        page.unroute('https://api.github.com/**')
        reset(page)
        api = GitHubMock(page)
        open_append(page)
        api.permission = False
        page.locator('#append-token').fill(TOKEN)
        page.locator('#append-connect').click()
        expect(page.locator('#append-status')).to_contain_text('没有此仓库的编辑权限')
        assert not page.evaluate('editor.token')
        page.locator('#append-close').click()
        # Ordinary editor still shares the authorization and version checks.
        page.locator('[data-action="edit-page"]').click()
        expect(page.locator('#editor-status')).to_contain_text('已载入最新内容')
        api.permission = True
        page.locator('#editor-auth summary').click()
        page.locator('#editor-token').fill(TOKEN)
        page.locator('#editor-connect').click()
        expect(page.locator('#editor-auth-state')).to_contain_text('已连接')
        page.locator(f'[data-field-key="{KEY}"]').fill('普通编辑器修改。')
        page.locator('#editor-save').click()
        expect(page.locator('#editor-status')).to_contain_text('已保存到 GitHub')
        assert api.value[KEY] == '普通编辑器修改。'
        page.locator(f'[data-field-key="{KEY}"]').fill('不覆盖远端修改。')
        api.sha = 'another-device-version'
        page.locator('#editor-save').click()
        expect(page.locator('#editor-status')).to_contain_text('检测到其他设备的修改')
        assert len(api.puts) == 1
        page.locator('#editor-close').click()
        print('PASS: denied account cannot connect; ordinary editor authorization/save/conflict checks remain intact.')

        reset(page)
        for section in ['intro', 'decision', 'scenarios', 'troubleshooting']:
            open_append(page, block('chapter/k01/'+section), 1, 8)
            assert page.evaluate('appendState.target.field.key') == 'chapter/k01/'+section
            page.locator('#append-close').click()
        page.locator('.question').first.locator('summary').click()
        open_append(page, block('question/01.1/answer'), 1, 8)
        page.locator('#append-close').click()
        select(page, block('question/01.1/title'), 1, 8)
        expect(page.locator('[data-selection-action="append"]')).not_to_be_visible()
        route(page, 'doubao')
        select(page, block('doubao/db-pm-01/title'), 1, 8)
        expect(page.locator('[data-selection-action="append"]')).not_to_be_visible()
        print('PASS: all four knowledge sections and core answers supported; titles and Doubao retain highlight-only behavior.')
        reset(page)
        page.locator(INTRO+' [data-append-index]').first.evaluate("el=>el.removeAttribute('data-append-index')")
        select(page, INTRO, 1, 8)
        expect(page.locator('[data-selection-action="append"]')).not_to_be_visible()
        print('PASS: an unmapped paragraph cannot fall through to a later insertion point.')

        # Translations preserve offsets and show correct domain-specific meanings.
        reset(page, 'k26')
        translated = page.evaluate("withChineseTerms('Token、Access Token、Refresh Token、AI（人工智能）、https://example.com/Token、gpt-6.1-sol')")
        assert translated == 'Token（词元）、Access Token（访问令牌）、Refresh Token（刷新令牌）、AI（人工智能）、https://example.com/Token、gpt-6.1-sol'
        page.locator('#search').fill('键值缓存')
        expect(page.locator('.result')).not_to_have_count(0)
        route(page, 'bank')
        page.locator('#bank-search').fill('大语言模型')
        expect(page.locator('#bank-results .bank-question')).not_to_have_count(0)
        print('PASS: Chinese terms, existing annotations, protected identifiers and Chinese search.')

        for width in [1366, 1280, 390, 320]:
            page.set_viewport_size({'width': width, 'height': 900})
            reset(page)
            for _ in range(5):
                page.locator('#reading-larger').click()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            open_append(page)
            page.locator('#append-input').fill('补充内容。\n'*30)
            dialog = page.locator('.append-editor').bounding_box()
            assert dialog['x'] >= 0 and dialog['x']+dialog['width'] <= width
            header = page.locator('.append-editor .editor-heading').bounding_box()
            footer = page.locator('.append-editor .editor-footer').bounding_box()
            page.locator('.append-editor .editor-body').evaluate('el=>el.scrollTop=el.scrollHeight')
            assert page.locator('.append-editor .editor-heading').bounding_box() == header
            assert page.locator('.append-editor .editor-footer').bounding_box() == footer
            assert footer['y'] + footer['height'] <= 900
            page.screenshot(path=f'/tmp/nico-append-{width}.png')
            page.locator('#append-close').click()
        print('PASS: 1366/1280/390/320 widths at 150%, no page overflow; modal header/footer fixed, content scrolls.')
        assert not errors, errors
        browser.close()


if __name__ == '__main__':
    run()
