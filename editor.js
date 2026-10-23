const editorRepo = 'nicoxu32/ai-agent-handbook';
const editorFile = `/repos/${editorRepo}/contents/content/edits.json`;
const editor = {token: '', base: structuredClone(DATA.edits), draft: structuredClone(DATA.edits), sha: '', group: '', busy: false, dirty: false, ready: false};
const editDialog = document.createElement('dialog');
editDialog.className = 'content-editor';
editDialog.setAttribute('aria-labelledby', 'editor-title');
editDialog.innerHTML = `
  <header class="editor-heading"><div><span class="eyebrow">EDIT CONTENT</span><h2 id="editor-title">编辑页面内容</h2></div><button type="button" class="btn small" id="editor-close" aria-label="关闭编辑">关闭</button></header>
  <p class="editor-help">直接修改文字，保存后自动发布到网站，通常需要几分钟。换行可分段，也支持 Markdown 排版。</p>
  <label class="editor-group-label">编辑位置<select id="editor-group" class="select"></select></label>
  <form id="editor-form"><div id="editor-fields"></div></form>
  <details id="editor-auth"><summary>GitHub 编辑授权 <span id="editor-auth-state">· 尚未连接</span></summary>
    <p>仅有此仓库写入权限的人可以发布。创建细粒度令牌，选择 <b>ai-agent-handbook</b> 仓库，并将 <b>Contents</b> 设为 <b>Read and write</b>，其余保持默认。令牌只在当前页面内存中使用，刷新或断开后需重新填写。</p>
    <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">前往 GitHub 创建授权令牌 ↗</a>
    <label>GitHub 授权令牌<input id="editor-token" type="password" autocomplete="off" spellcheck="false" placeholder="仅在此处填写，不要写入正文"></label>
    <div class="actions"><button type="button" class="btn small" id="editor-connect">连接 GitHub</button><button type="button" class="text-button" id="editor-disconnect" hidden>断开连接</button></div>
  </details>
  <p id="editor-status" role="status" aria-live="polite"></p>
  <div id="editor-published" hidden><a href="https://github.com/${editorRepo}/actions" target="_blank" rel="noopener noreferrer">查看自动发布进度 ↗</a><span>发布成功后刷新网站查看。</span></div>
  <footer class="editor-footer"><div class="actions"><button type="button" class="text-button" id="editor-discard">撤销修改</button><button type="button" class="text-button" id="editor-export">下载修改备份</button><button type="button" class="text-button" id="editor-reload">载入最新内容</button></div><button type="submit" form="editor-form" class="btn primary" id="editor-save">保存并发布</button></footer>`;
document.body.append(editDialog);
const editorFields = editDialog.querySelector('#editor-fields');
const editorGroup = editDialog.querySelector('#editor-group');
const editorStatus = editDialog.querySelector('#editor-status');
const editorToken = editDialog.querySelector('#editor-token');
const editorGroups = [
  {id: 'home', title: '学习总览 · 指南与路径'},
  ...Object.keys(DATA.pages).filter(id => id !== 'home').map(id => ({id, title: '页面介绍 · ' + DATA.pages[id].title})),
  ...DATA.chapters.map(chapter => ({id: chapter.id, title: `${chapter.number} · ${chapter.short}（含三道面试题）`})),
  ...DATA.doubao.questions.map(question => ({id: question.id, title: `豆包 · ${DATA.doubao.categories[question.category]} ${question.id.split('-').at(-1)} · ${question.title}`})),
  ...DATA.architecture.nodes.map(node => ({id: 'arch-' + node.id, title: '架构图 · ' + node.title})),
  ...Object.entries(DATA.architecture.traces).map(([id, trace]) => ({id: 'trace-' + id, title: '任务路径 · ' + trace.title})),
  ...DATA.glossary.map((item, index) => ({id: 'glossary-' + index, title: '术语 · ' + item.term})),
  ...DATA.extras.filter(extra => ['extra1', 'extra2', 'extra4'].includes(extra.id)).map(extra => ({id: extra.id, title: extra.title}))
];
editorGroup.innerHTML = editorGroups.map(group => `<option value="${group.id}">${escapeHTML(group.title)}</option>`).join('');

function editableValue(field, overrides = editor.draft) {
  return Object.hasOwn(overrides, field.key) ? overrides[field.key] : field.value;
}
function editorMessage(message, error = false) {
  editorStatus.textContent = message;
  editorStatus.classList.toggle('error', error);
}
function updateEditorControls() {
  editDialog.querySelectorAll('input,textarea,select,button').forEach(control => { control.disabled = editor.busy; });
  editorFields.querySelectorAll('input,textarea').forEach(control => { control.disabled = editor.busy || !editor.ready; });
  editDialog.querySelector('#editor-save').disabled = editor.busy || !editor.ready || !editor.dirty;
  editDialog.querySelector('#editor-save').textContent = editor.busy ? '正在处理…' : '保存并发布';
  editDialog.querySelector('#editor-auth-state').textContent = editor.token ? '· 已连接' : '· 尚未连接';
  editDialog.querySelector('#editor-disconnect').hidden = !editor.token;
}
function renderEditorFields() {
  editorGroup.value = editor.group;
  editorFields.replaceChildren();
  DATA.editorFields.filter(field => field.group === editor.group).forEach(field => {
    const label = document.createElement('label');
    label.textContent = field.label;
    const input = document.createElement(field.multiline ? 'textarea' : 'input');
    input.dataset.fieldKey = field.key;
    input.value = editableValue(field);
    input.required = true;
    input.maxLength = field.multiline ? 40000 : 300;
    if (field.multiline) input.rows = Math.min(18, Math.max(4, Math.ceil(input.value.length / 65)));
    label.append(input);
    editorFields.append(label);
  });
  updateEditorControls();
}
function validateOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('内容文件格式不正确，未覆盖现有内容。');
  const known = new Map(DATA.editorFields.map(field => [field.key, field]));
  for (const [key, text] of Object.entries(value)) {
    const field = known.get(key);
    if (!field) throw new Error('网站结构已有更新，请先下载修改备份，再刷新网站。');
    if (typeof text !== 'string' || !text.trim() || text.length > (field.multiline ? 40000 : 300) || (!field.multiline && text.includes('\n'))) {
      throw new Error(`「${field.label}」为空或过长，请检查后重试。`);
    }
  }
}
async function githubRequest(path, {method = 'GET', body, token = editor.token} = {}) {
  const headers = {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch('https://api.github.com' + path, {method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(25000)});
  } catch {
    throw new Error('无法连接 GitHub，可能是网络或请求超时。修改仍保留在当前页面，可先下载备份。');
  }
  if (!response.ok) {
    const messages = {401: '授权已失效，请重新连接 GitHub。', 403: 'GitHub 拒绝请求：请检查令牌的仓库权限或稍后重试。', 404: '无法访问内容文件，请检查授权是否选择了 ai-agent-handbook 仓库。', 409: '内容已被其他设备修改，请下载备份后载入最新内容。', 422: 'GitHub 未接受此次保存，请检查权限并载入最新内容。', 429: 'GitHub 请求频繁，请稍后重试。'};
    throw new Error(messages[response.status] || 'GitHub 暂时不可用，修改尚未确认保存。');
  }
  return response.json();
}
function encodeContent(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
  if (bytes.length > 900000) throw new Error('内容超过单次保存上限，请下载备份后联系维护者。');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function readEditorFile() {
  const file = await githubRequest(editorFile + '?ref=main');
  if (file.encoding !== 'base64' || !file.sha) throw new Error('无法读取内容文件，请稍后重试。');
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Uint8Array.from(atob(file.content.replace(/\s/g, '')), char => char.charCodeAt(0))));
  } catch {
    throw new Error('内容文件无法解析，未覆盖当前修改。');
  }
  validateOverrides(value);
  return {value, sha: file.sha};
}
async function loadEditorContent() {
  if (editor.busy) return;
  editor.busy = true;
  updateEditorControls();
  editorMessage('正在读取 GitHub 上的最新内容…');
  try {
    const file = await readEditorFile();
    editor.base = file.value;
    editor.draft = structuredClone(file.value);
    editor.sha = file.sha;
    editor.ready = true;
    editor.dirty = false;
    editDialog.querySelector('#editor-published').hidden = true;
    renderEditorFields();
    editorMessage('已载入最新内容。修改后点击「保存并发布」。');
  } catch (error) {
    editorMessage(error.message, true);
  } finally {
    editor.busy = false;
    updateEditorControls();
  }
}
function groupForCurrentPage() {
  if (DATA.doubao.questions.some(question => question.id === activeRoute)) return activeRoute;
  if (activeRoute === 'doubao') return main.querySelector('.doubao-question[open]')?.dataset.questionId || filteredDoubaoQuestions()[0]?.id || DATA.doubao.questions[0].id;
  if (DATA.chapters.some(chapter => chapter.id === activeRoute)) return activeRoute;
  if (activeRoute.startsWith('challenge')) return challengeChapter().id;
  if (activeRoute === 'practice') return practiceQuestions()[state.practiceIndex].chapter.id;
  if (activeRoute === 'bank' || activeRoute === 'catalog') return DATA.chapters.some(chapter => chapter.id === bankScope) ? bankScope : state.last;
  if (activeRoute === 'glossary') return 'glossary-0';
  if (activeRoute === 'architecture') return 'arch-' + DATA.architecture.nodes[0].id;
  return editorGroups.some(group => group.id === activeRoute) ? activeRoute : 'home';
}
async function openEditor() {
  editor.group = groupForCurrentPage();
  renderEditorFields();
  editDialog.showModal();
  if (!editor.dirty) await loadEditorContent();
  else editorMessage('已恢复当前页面中尚未发布的修改。');
}
function closeEditor() {
  if (editor.busy) return;
  editorToken.value = '';
  editDialog.close();
}
async function connectEditor() {
  if (editor.busy) return;
  const token = editorToken.value.trim();
  if (!token) { editorMessage('请先填写 GitHub 授权令牌。', true); editorToken.focus(); return; }
  editor.busy = true;
  updateEditorControls();
  editorMessage('正在验证仓库访问权限…');
  try {
    const repository = await githubRequest('/repos/' + editorRepo, {token});
    if (repository.full_name !== editorRepo || !repository.permissions?.push) throw new Error('当前账号没有此仓库的编辑权限。');
    editor.token = token;
    editorToken.value = '';
    editDialog.querySelector('#editor-auth').open = false;
    editorMessage('已连接 GitHub。修改后点击「保存并发布」。');
  } catch (error) {
    editorMessage(error.message, true);
  } finally {
    editor.busy = false;
    updateEditorControls();
  }
  if (editor.token && !editor.ready) await loadEditorContent();
}
function sameEdits(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}
async function saveEditor(event) {
  event.preventDefault();
  if (editor.busy || !editor.ready || !editor.dirty) return;
  if (!editor.token) {
    editDialog.querySelector('#editor-auth').open = true;
    editorMessage('请先连接 GitHub，以确认你有发布权限。');
    editorToken.focus();
    return;
  }
  editor.busy = true;
  updateEditorControls();
  editorMessage('正在检查版本并保存…');
  editDialog.querySelector('#editor-published').hidden = true;
  try {
    validateOverrides(editor.draft);
    if (Object.values(editor.draft).some(text => text.includes(editor.token) || /\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{15,}/.test(text))) throw new Error('正文中发现授权凭据，请删除后再发布。');
    const latest = await readEditorFile();
    if (latest.sha !== editor.sha) throw new Error('检测到其他设备的修改，尚未发布。请先下载修改备份，再载入最新内容，避免覆盖。');
    let result;
    try {
      result = await githubRequest(editorFile, {method: 'PUT', body: {message: 'Update handbook content from page editor', content: encodeContent(editor.draft), sha: editor.sha, branch: 'main'}});
    } catch (error) {
      // A lost response does not mean the commit failed. Read back before offering a retry.
      const confirmed = await readEditorFile().catch(() => null);
      if (!confirmed || !sameEdits(confirmed.value, editor.draft)) throw error;
      result = {content: {sha: confirmed.sha}};
    }
    editor.sha = result.content.sha;
    editor.base = structuredClone(editor.draft);
    editor.dirty = false;
    editorMessage('已保存到 GitHub，正在自动发布。网站更新通常需要几分钟。');
    editDialog.querySelector('#editor-published').hidden = false;
  } catch (error) {
    editorMessage(error.message, true);
  } finally {
    editor.busy = false;
    updateEditorControls();
  }
}
editorFields.addEventListener('input', event => {
  const field = DATA.editorFields.find(item => item.key === event.target.dataset.fieldKey);
  if (!field) return;
  if (event.target.value === field.value) delete editor.draft[field.key];
  else editor.draft[field.key] = event.target.value;
  editor.dirty = !sameEdits(editor.draft, editor.base);
  editDialog.querySelector('#editor-published').hidden = true;
  editorMessage(editor.dirty ? '有未发布的修改，关闭编辑窗口后仍保留；刷新或关闭网页前请保存或下载备份。' : '内容未改变。');
  updateEditorControls();
});
editorGroup.addEventListener('change', () => { editor.group = editorGroup.value; renderEditorFields(); });
editDialog.querySelector('#editor-form').addEventListener('submit', saveEditor);
editDialog.querySelector('#editor-close').addEventListener('click', closeEditor);
editDialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
editDialog.querySelector('#editor-connect').addEventListener('click', connectEditor);
editDialog.querySelector('#editor-disconnect').addEventListener('click', () => {
  editor.token = '';
  editorToken.value = '';
  editorMessage('已断开 GitHub，当前修改仍保留。');
  updateEditorControls();
});
editDialog.querySelector('#editor-reload').addEventListener('click', () => {
  if (editor.dirty && !confirm('载入最新内容将丢弃当前未发布修改。已下载备份并确认继续吗？')) return;
  loadEditorContent();
});
editDialog.querySelector('#editor-discard').addEventListener('click', () => {
  if (editor.dirty && !confirm('撤销本次尚未发布的修改？已发布内容不受影响。')) return;
  editor.draft = structuredClone(editor.base);
  editor.dirty = false;
  renderEditorFields();
  editorMessage('已撤销未发布的修改。');
});
editDialog.querySelector('#editor-export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(editor.draft, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'handbook-content-backup.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('click', event => {
  if (event.target.closest('[data-action="edit-page"]')) openEditor();
});
window.addEventListener('beforeunload', event => {
  if (editor.dirty || editor.busy) { event.preventDefault(); event.returnValue = ''; }
});
