const editorRepo = 'nicoxu32/ai-agent-handbook';
const editor = {base: {}, draft: {}, revision: '', group: '', busy: false, dirty: false, ready: false, token: ''};
const localEditing = !STATIC_SITE && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const publishButton = document.querySelector('#publish-content');
const publishStatus = document.querySelector('#publish-status');
let publishing = false;
publishButton.hidden = !localEditing;
document.querySelector('.topbar-edit').hidden = !localEditing;
const editorDraftKey = 'nico-handbook-local-editor-drafts-v1';
const editDialog = document.createElement('dialog');
editDialog.className = 'content-editor';
editDialog.setAttribute('aria-labelledby', 'editor-title');
editDialog.innerHTML = `
  <header class="editor-heading"><div><span class="eyebrow">正文编辑</span><h2 id="editor-title">编辑页面内容</h2></div><button type="button" class="btn small" id="editor-close">关闭</button></header>
  <div class="editor-body">
    <p class="editor-help">回车换行，空行分段。保存到电脑里的 Markdown 文件后，阅读页面立即更新；积累修改后再统一发布。</p>
    <label><span>编辑位置</span><select id="editor-group" class="select"></select></label>
    <p id="editor-path" class="editor-help"></p>
    <form id="editor-form"><div id="editor-fields"></div></form>
    <p id="editor-status" role="status" aria-live="polite"></p>
  </div>
  <footer class="editor-footer"><div class="actions"><button type="button" class="text-button" id="editor-open-file">打开 Markdown 文件</button><button type="button" class="text-button" id="editor-export">下载草稿备份</button><button type="button" class="text-button" id="editor-reload">载入最新文件</button></div><div class="actions"><button type="submit" form="editor-form" class="btn primary" id="editor-save">保存到本地</button></div></footer>`;
document.body.append(editDialog);
const editorFields = editDialog.querySelector('#editor-fields');
const editorGroup = editDialog.querySelector('#editor-group');
const editorGroups = [...new Set(DATA.editorFields.map(field => field.group))].map(id => {
  const chapter = DATA.chapters.find(item => item.id === id);
  const question = DATA.doubao.questions.find(item => item.id === id);
  const node = DATA.architecture.nodes.find(item => 'arch-' + item.id === id);
  const extra = DATA.extras.find(item => item.id === id);
  const trace = DATA.architecture.traces[id.replace(/^trace-/, '')];
  const title = chapter?.title || question?.title || node?.title || extra?.title || trace?.title || DATA.pages[id]?.title || id;
  return {id, title};
});
editorGroup.innerHTML = editorGroups.map(item => `<option value="${item.id}">${escapeHTML(item.title)}</option>`).join('');

function editableValue(field, overrides = editor.draft) {
  return Object.hasOwn(overrides, field.key) ? overrides[field.key] : field.value;
}
function sameEdits(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}
function editorMessage(message, error = false) {
  const status = editDialog.querySelector('#editor-status');
  status.textContent = message;
  status.classList.toggle('error', error);
}
async function localRequest(path, body) {
  if (!localEditing) throw new Error('请在电脑上打开本地学习手册，再编辑 Markdown 文件。线上网站用于查看已发布内容。');
  if (!editor.token) {
    const response = await fetch('/api/local/status', {cache: 'no-store'});
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || '本地服务未就绪。');
    editor.token = status.token;
    showPublishStatus(status);
  }
  const response = await fetch('/api/local/' + path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Handbook-Token': editor.token}, body: JSON.stringify(body), signal: AbortSignal.timeout(path === 'publish' ? 180000 : 30000)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '本地操作失败，请保留草稿后重试。');
  return result;
}
function showPublishStatus(status) {
  const pending = status.pending || 0;
  const unpushed = status.unpushed || 0;
  publishButton.title = pending || unpushed
    ? `本地有 ${pending} 篇修改待发布${unpushed ? '，另有已提交但尚未同步的内容' : ''}。`
    : '本地内容已与最近同步的版本一致。';
}
function updateEditorControls() {
  editDialog.querySelectorAll('input,textarea,select,button').forEach(control => { control.disabled = editor.busy; });
  editorFields.querySelectorAll('input,textarea').forEach(control => { control.disabled = editor.busy || !editor.ready; });
  editDialog.querySelector('#editor-save').disabled = editor.busy || !editor.ready || !editor.dirty;
  editDialog.querySelector('#editor-open-file').disabled = editor.busy || !localEditing || editor.dirty;
  editDialog.querySelector('#editor-open-file').title = editor.dirty ? '请先保存或备份并载入最新文件，再打开原文件。' : '使用电脑的文本编辑器打开当前篇目';
  publishButton.disabled = publishing || editor.busy;
  editDialog.querySelector('#editor-save').textContent = editor.busy ? '正在处理…' : '保存到本地';
}
function renderEditorFields() {
  editorGroup.value = editor.group;
  editorFields.replaceChildren();
  for (const field of DATA.editorFields.filter(item => item.group === editor.group)) {
    const label = document.createElement('label');
    const caption = document.createElement('span');
    caption.textContent = field.label;
    const input = document.createElement(field.multiline ? 'textarea' : 'input');
    input.dataset.fieldKey = field.key;
    input.value = editableValue(field);
    input.required = true;
    input.maxLength = field.multiline ? 40000 : 300;
    if (field.multiline) input.rows = Math.min(18, Math.max(4, Math.ceil(input.value.length / 65)));
    label.append(caption, input);
    updateTermNotes(input);
    editorFields.append(label);
  }
  updateEditorControls();
}
function readEditorDrafts() {
  try {
    const drafts = JSON.parse(localStorage.getItem(editorDraftKey) || '{}');
    return drafts && typeof drafts === 'object' && !Array.isArray(drafts) ? drafts : {};
  }
  catch { return {}; }
}
function persistEditorDraft() {
  try {
    const drafts = readEditorDrafts();
    if (editor.dirty) drafts[editor.group] = {values: editor.draft, revision: editor.revision};
    else delete drafts[editor.group];
    localStorage.setItem(editorDraftKey, JSON.stringify(drafts));
  } catch { editorMessage('浏览器无法暂存草稿，请保存到本地文件或下载备份。', true); }
}
async function loadEditorContent() {
  editor.busy = true;
  editor.ready = false;
  updateEditorControls();
  try {
    const result = await localRequest('document', {group: editor.group});
    editor.base = result.values;
    editor.draft = structuredClone(result.values);
    editor.revision = result.revision;
    editor.ready = true;
    const draft = readEditorDrafts()[editor.group];
    if (draft?.values && draft.revision) {
      // Keep the original revision so an old draft cannot overwrite a newer file.
      editor.draft = draft.values;
      editor.revision = draft.revision;
    }
    editor.dirty = !sameEdits(editor.draft, editor.base);
    editDialog.querySelector('#editor-path').textContent = '本地文件：' + result.path;
    editorMessage(editor.dirty ? '已恢复未保存草稿。保存到本地后阅读页面立即更新。' : '已读取电脑里的最新文件。');
    renderEditorFields();
  } catch (error) { editorMessage(error.message, true); }
  finally { editor.busy = false; updateEditorControls(); }
}
function groupForCurrentPage() {
  if (editorGroups.some(item => item.id === activeRoute)) return activeRoute;
  if (activeRoute === 'doubao') return main.querySelector('.doubao-question[open]')?.dataset.questionId || DATA.doubao.questions[0].id;
  if (activeRoute.startsWith('challenge')) return challengeChapter().id;
  if (activeRoute === 'practice') return practiceQuestions()[state.practiceIndex].chapter.id;
  if (activeRoute === 'architecture') return 'arch-' + DATA.architecture.nodes[0].id;
  if (activeRoute === 'bank') return state.last;
  return 'home';
}
async function openEditor() {
  editor.group = groupForCurrentPage();
  editor.draft = {};
  renderEditorFields();
  editDialog.showModal();
  if (!localEditing) {
    editor.ready = false;
    editorFields.replaceChildren();
    editorMessage('线上网站展示已发布内容。请双击电脑里的「打开学习手册.command」，在本地网页编辑和保存；之后可统一发布到这里。');
    updateEditorControls();
    return;
  }
  await loadEditorContent();
}
function closeEditor() {
  if (editor.busy) return;
  persistEditorDraft();
  editDialog.close();
}
function reloadLocalReading() {
  sessionStorage.setItem('nico-local-save-scroll', String(scrollY));
  location.reload();
}
async function saveEditor(event) {
  event.preventDefault();
  if (editor.busy || !editor.ready || !editor.dirty) return;
  editor.busy = true;
  updateEditorControls();
  editorMessage('正在保存本地 Markdown 文件…');
  try {
    const result = await localRequest('save', {group: editor.group, revision: editor.revision, values: editor.draft});
    editor.dirty = false;
    persistEditorDraft();
    showPublishStatus(result);
    reloadLocalReading();
  } catch (error) {
    persistEditorDraft();
    editorMessage(error.message, true);
  } finally { editor.busy = false; updateEditorControls(); }
}
editorFields.addEventListener('input', event => {
  if (!event.target.dataset.fieldKey) return;
  editor.draft[event.target.dataset.fieldKey] = event.target.value;
  editor.dirty = !sameEdits(editor.draft, editor.base);
  updateTermNotes(event.target);
  persistEditorDraft();
  editorMessage(editor.dirty ? '草稿已暂存，点击「保存到本地」写入 Markdown 文件。' : '内容未改变。');
  updateEditorControls();
});
editorGroup.addEventListener('change', async () => {
  persistEditorDraft();
  editor.group = editorGroup.value;
  await loadEditorContent();
});
editDialog.querySelector('#editor-form').addEventListener('submit', saveEditor);
editDialog.querySelector('#editor-close').addEventListener('click', closeEditor);
editDialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
editDialog.querySelector('#editor-reload').addEventListener('click', async () => {
  if (editor.dirty && !confirm('载入最新文件将放弃此篇未保存草稿，请先下载备份。继续吗？')) return;
  editor.dirty = false;
  persistEditorDraft();
  await loadEditorContent();
});
editDialog.querySelector('#editor-export').addEventListener('click', () => {
  const fields = DATA.editorFields.filter(item => item.group === editor.group);
  const text = fields.map(field => '## ' + field.label + '\n\n' + editableValue(field)).join('\n\n');
  const url = URL.createObjectURL(new Blob([text], {type: 'text/markdown;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = editor.group + '-草稿.md';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
editDialog.querySelector('#editor-open-file').addEventListener('click', async () => {
  if (editor.busy || editor.dirty) return;
  editor.busy = true;
  updateEditorControls();
  try {
    await localRequest('open-document', {group: editor.group});
    editorMessage('已请求文本编辑器打开原文件。保存后点击「载入最新文件」，或关闭弹窗并刷新网页查看；请保留文件中的字段标记。');
  } catch (error) { editorMessage(error.message, true); }
  finally { editor.busy = false; updateEditorControls(); }
});
publishButton.addEventListener('click', async () => {
  if (publishing || editor.busy) return;
  publishing = true;
  publishButton.textContent = '正在发布…';
  publishStatus.hidden = false;
  publishStatus.textContent = '正在同步已保存的文档，未保存草稿不参与发布。';
  updateEditorControls();
  try {
    const result = await localRequest('publish', {});
    showPublishStatus(result);
    publishStatus.replaceChildren(document.createTextNode('已同步，等待网站部署。'));
    const link = document.createElement('a');
    link.href = `https://github.com/${editorRepo}/actions`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '查看发布进度 ↗';
    publishStatus.append(link);
  } catch (error) { publishStatus.textContent = error.message; }
  finally {
    publishing = false;
    publishButton.textContent = '发布到 GitHub';
    updateEditorControls();
  }
});
document.addEventListener('click', event => {
  if (event.target.closest('[data-action="edit-page"]')) openEditor();
});
window.addEventListener('beforeunload', event => {
  if (editor.busy || publishing) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('load', () => {
  const position = sessionStorage.getItem('nico-local-save-scroll');
  if (position !== null) {
    sessionStorage.removeItem('nico-local-save-scroll');
    window.scrollTo({top: Number(position), behavior: 'instant'});
    notify('已保存到本地，阅读内容已更新。');
  }
});
