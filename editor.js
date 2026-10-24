const editorRepo = 'nicoxu32/ai-agent-handbook';
const editor = {base: {}, draft: {}, rich: {}, revision: '', group: '', busy: false, dirty: false,
  ready: false, token: '', active: false, reloading: false, instances: new Map(), focus: null};
const localEditing = !STATIC_SITE && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const publishButton = document.querySelector('#publish-content');
const publishStatus = document.querySelector('#publish-status');
const editButton = document.querySelector('.topbar-edit');
let publishing = false;
publishButton.hidden = !localEditing;
editButton.hidden = !localEditing;
const editorDraftKey = 'nico-handbook-local-editor-drafts-v1';
const resumeEditorKey = 'nico-handbook-inline-editor-resume';
const editorBar = document.createElement('section');
editorBar.className = 'document-toolbar';
editorBar.hidden = true;
editorBar.setAttribute('aria-label', '当前页面编辑工具');
editorBar.innerHTML = `
  <div class="document-toolbar-heading"><div class="document-mode"><span class="editing-dot" aria-hidden="true"></span><strong>正在编辑当前页</strong><span id="editor-status" role="status" aria-live="polite"></span></div><div class="document-save-actions"><button class="btn small" type="button" id="editor-close">退出编辑</button><button class="btn small primary" type="button" id="editor-save">保存到本地</button></div></div>
  <div class="document-format-bar" role="toolbar" aria-label="文字与段落排版">
    <button type="button" data-editor-format="undo" title="撤销（Ctrl / ⌘ Z）">↶ 撤销</button><button type="button" data-editor-format="redo" title="重做（Ctrl / ⌘ Shift Z）">↷ 重做</button>
    <span class="document-tool-divider"></span><select id="editor-text-style" aria-label="段落样式"><option value="paragraph">正文</option><option value="heading2">二级标题</option><option value="heading3">三级标题</option></select>
    <button type="button" data-editor-format="bold"><b>加粗</b></button><button type="button" data-editor-format="underline"><u>下划线</u></button><button type="button" data-editor-format="code">行内代码</button><button type="button" data-editor-format="codeBlock">代码块</button>
    <span class="document-tool-divider"></span><button type="button" data-editor-format="number">编号</button><button type="button" data-editor-format="bullet">列表</button><button type="button" data-editor-format="quote">引用</button><button type="button" data-editor-format="block">独立块</button><button type="button" data-editor-format="table">插入表格</button><button type="button" data-editor-format="image">插入图片</button>
    <span class="document-table-tools" hidden><button type="button" data-editor-format="addRow">加行</button><button type="button" data-editor-format="addColumn">加列</button><button type="button" data-editor-format="deleteRow">删行</button><button type="button" data-editor-format="deleteColumn">删列</button><button type="button" data-editor-format="deleteTable">删表格</button></span>
  </div>
  <div class="document-file-tools"><label id="editor-group-label" hidden>编辑位置 <select id="editor-group"></select></label><span id="editor-path"></span><button type="button" id="editor-open-file">打开 Markdown</button><button type="button" id="editor-export">下载草稿备份</button><button type="button" id="editor-reload">载入最新文件</button></div>`;
main.before(editorBar);
const editorGroup = editorBar.querySelector('#editor-group');
const editorGroups = [...new Set(DATA.editorFields.map(field => field.group))].map(id => {
  const chapter = DATA.chapters.find(item => item.id === id);
  const question = DATA.doubao.questions.find(item => item.id === id);
  const node = DATA.architecture.nodes.find(item => 'arch-' + item.id === id);
  const extra = DATA.extras.find(item => item.id === id);
  const trace = DATA.architecture.traces[id.replace(/^trace-/, '')];
  const title = chapter?.title || question?.title || node?.title || extra?.title || trace?.title || DATA.pages[id]?.title || id;
  return {id, title};
});
function sameEdits(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}
function editableValue(field, overrides = editor.draft) {
  return Object.hasOwn(overrides, field.key) ? overrides[field.key] : field.value;
}
function editorMessage(message, error = false) {
  const status = editorBar.querySelector('#editor-status');
  status.textContent = message;
  status.classList.toggle('error', error);
}
async function localRequest(path, body, signal, onDelta) {
  if (!localEditing) throw new Error('请在电脑上打开本地学习手册，再编辑 Markdown 文件。线上网站用于查看已发布内容。');
  const timeout = {publish: 180000, followup: 90000}[path] || 30000;
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!editor.token) {
      const response = await fetch('/api/local/status', {cache: 'no-store', signal: requestSignal});
      const status = await response.json();
      if (!response.ok) throw new Error(status.error || '本地服务未就绪。');
      if (status.app !== 'nico-handbook-local-v1' || typeof status.token !== 'string' || !status.token) {
        throw new Error('未连接到本地学习手册服务，请保留草稿后重试。');
      }
      editor.token = status.token;
      showPublishStatus(status);
    }
    const response = await fetch('/api/local/' + path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Handbook-Token': editor.token}, body: JSON.stringify(body), signal: requestSignal});
    if (response.ok && onDelta && response.headers.get('Content-Type')?.includes('text/event-stream')) {
      return readFollowupStream(response, onDelta);
    }
    const result = await response.json();
    // Retry only when the server explicitly rejected the request before executing it.
    if (response.status === 403 && result.code === 'session_expired') {
      editor.token = '';
      if (attempt === 0) continue;
    }
    if (!response.ok) throw new Error(result.error || '本地操作失败，请保留草稿后重试。');
    return result;
  }
}
function showPublishStatus(status) {
  const pending = status.pending || 0;
  const unpushed = status.unpushed || 0;
  const images = status.images || 0;
  publishButton.title = pending || unpushed || images
    ? `本地有 ${pending} 篇修改${images ? `、${images} 张图片` : ''}待发布${unpushed ? '，另有已提交但尚未同步的内容' : ''}。`
    : '本地内容已与最近同步的版本一致。';
}
function readEditorDrafts() {
  try {
    const drafts = JSON.parse(localStorage.getItem(editorDraftKey) || '{}');
    return drafts && typeof drafts === 'object' && !Array.isArray(drafts) ? drafts : {};
  } catch { return {}; }
}
function persistEditorDraft() {
  try {
    const drafts = readEditorDrafts();
    if (editor.dirty) drafts[editor.group] = {values: editor.draft, rich: editor.rich, revision: editor.revision};
    else delete drafts[editor.group];
    localStorage.setItem(editorDraftKey, JSON.stringify(drafts));
  } catch { editorMessage('浏览器无法暂存草稿，请保存到本地或下载备份。', true); }
}
function updateEditorControls() {
  editorBar.querySelectorAll('button,select').forEach(control => { control.disabled = editor.busy; });
  const instance = editor.focus;
  const rich = Boolean(instance && !instance.plain);
  editorBar.querySelectorAll('[data-editor-format],#editor-text-style').forEach(control => {
    control.disabled = editor.busy || !rich;
  });
  for (const instance of editor.instances.values()) {
    if (instance.plain) instance.element.contentEditable = editor.busy ? 'false' : 'plaintext-only';
    else instance.view.setEditable(!editor.busy, false);
  }
  editorBar.querySelector('#editor-save').disabled = editor.busy || !editor.ready || !editor.dirty;
  editorBar.querySelector('#editor-save').textContent = editor.busy ? '正在处理…' : '保存到本地';
  editorBar.querySelector('#editor-open-file').disabled = editor.busy || editor.dirty;
  editorBar.querySelector('#editor-open-file').title = editor.dirty ? '请先保存到本地，再打开原文件。' : '在电脑文本编辑器中打开原文件';
  editButton.disabled = editor.busy;
  publishButton.disabled = publishing || editor.busy;
  editorBar.querySelector('.document-table-tools').hidden = !rich || !instance.view.isActive('table');
  const marks = {bold: 'bold', underline: 'underline', code: 'code', codeBlock: 'codeBlock', number: 'orderedList', bullet: 'bulletList'};
  for (const [action, mark] of Object.entries(marks)) {
    editorBar.querySelector(`[data-editor-format="${action}"]`).setAttribute('aria-pressed', String(Boolean(rich && instance.view.isActive(mark))));
  }
  let textStyle = 'paragraph';
  if (rich && instance.view.isActive('heading', {level: 2})) textStyle = 'heading2';
  else if (rich && instance.view.isActive('heading', {level: 3})) textStyle = 'heading3';
  editorBar.querySelector('#editor-text-style').value = textStyle;
}
function editorChanged() {
  editor.dirty = !sameEdits(editor.draft, editor.base) || Object.keys(editor.rich).length > 0;
  persistEditorDraft();
  editorMessage(editor.dirty ? '草稿已暂存，尚未写入本地文件' : '本地文件内容未改变');
  updateEditorControls();
}
function fieldTarget(field) {
  const existing = [...main.querySelectorAll('[data-highlight-key]')].find(node => node.dataset.highlightKey === field.key);
  if (existing) return existing;
  const parts = field.key.split('/');
  if (parts[0] === 'chapter' && parts[2] === 'title') {
    const heading = main.querySelector('.lesson-head h1');
    if (heading) { main.querySelector('.lesson-subtitle').hidden = true; return heading; }
  }
  if (parts[0] === 'page') return main.querySelector(parts[2] === 'title' ? '.workspace-page-head h1' : '.workspace-page-head .hero-copy');
  if (parts[0] === 'round') {
    const card = main.querySelectorAll('.path-card')[Number(parts[1])];
    return card?.querySelector(parts[2] === 'title' ? '.path-head h3' : ':scope > p');
  }
  if (parts[0] === 'architecture') {
    const node = document.getElementById('arch-' + parts[1]);
    const selectors = {title: 'h3', description: ':scope > p', input: 'dl>div:first-child dd', output: 'dl>div:last-child dd'};
    return node?.querySelector(selectors[parts[2]]);
  }
  return null;
}
function mountEditorFields(preview) {
  main.querySelectorAll('details.question,details.doubao-question,details.doubao-supplement').forEach(detail => { detail.open = true; });
  let extra;
  for (const field of DATA.editorFields.filter(item => item.group === editor.group)) {
    let target = fieldTarget(field);
    if (!target) {
      if (!extra) {
        extra = document.createElement('section');
        extra.className = 'document-extra-fields reader';
        extra.innerHTML = '<h2>本篇的其他内容</h2>';
        main.append(extra);
      }
      const section = document.createElement('section');
      section.innerHTML = `<h3>${escapeHTML(field.label)}</h3>`;
      target = document.createElement('div');
      target.className = 'prose';
      section.append(target);extra.append(section);
    }
    target.removeAttribute('data-highlight-key');
    target.replaceChildren();
    target.classList.add('document-field');
    target.dataset.fieldKey = field.key;
    target.dataset.rawText = '';
    target.setAttribute('aria-label', field.label);
    if (!field.multiline) {
      target.classList.add('document-plain');
      target.contentEditable = 'plaintext-only';
      target.setAttribute('role', 'textbox');
      target.setAttribute('aria-multiline', 'false');
      target.textContent = editor.draft[field.key];
      const instance = {plain: true, element: target, field};
      editor.instances.set(field.key, instance);
      target.addEventListener('focus', () => { editor.focus = instance;updateEditorControls(); });
      target.addEventListener('input', () => { editor.draft[field.key] = target.innerText.replace(/\r?\n/g, ' ');editorChanged(); });
      target.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
    } else {
      const instance = {plain: false, field, element: target, view: null, initial: ''};
      instance.view = HandbookRichEditor.create(target, preview.html[field.key], {
        label: field.label,
        onFocus: () => { editor.focus = instance;updateEditorControls(); },
        onSelect: () => { editor.focus = instance;updateEditorControls(); },
        onChange: view => {
          const html = view.getHTML();
          if (html === instance.initial) delete editor.rich[field.key];
          else editor.rich[field.key] = html;
          editorChanged();
        }
      });
      instance.initial = instance.view.getHTML();
      if (editor.rich[field.key]) instance.view.commands.setContent(editor.rich[field.key], {emitUpdate: false});
      editor.instances.set(field.key, instance);
    }
  }
}
function groupForCurrentPage() {
  if (editorGroups.some(item => item.id === activeRoute)) return activeRoute;
  if (activeRoute === 'doubao') return main.querySelector('.doubao-question[open]')?.dataset.questionId || DATA.doubao.questions[0].id;
  if (activeRoute.startsWith('challenge')) return challengeChapter().id;
  if (activeRoute === 'practice') return practiceQuestions()[state.practiceIndex].chapter.id;
  return 'home';
}
async function openEditor(group = groupForCurrentPage()) {
  if (!localEditing || editor.busy || editor.active) return;
  if (typeof appendState !== 'undefined' && appendState.open) closeAppend();
  editor.group = group;
  editor.busy = true;
  editor.ready = false;
  editorBar.hidden = false;
  editorMessage('正在读取本地 Markdown…');
  updateEditorControls();
  const route = activeRoute;
  try {
    const result = await localRequest('document', {group});
    if (route !== activeRoute) { editorBar.hidden = true;return; }
    editor.base = result.values;
    editor.draft = structuredClone(result.values);
    editor.rich = {};
    editor.revision = result.revision;
    const draft = readEditorDrafts()[group];
    const compatibleDraft = draft?.values && draft.revision &&
      Object.keys(draft.values).length === Object.keys(result.values).length &&
      Object.keys(result.values).every(key => typeof draft.values[key] === 'string');
    if (compatibleDraft) {
      editor.draft = structuredClone(draft.values);
      editor.rich = structuredClone(draft.rich || {});
      editor.revision = draft.revision;
    }
    let preview = result;
    if (!sameEdits(editor.draft, result.values)) preview = await localRequest('editor-preview', {group, values: editor.draft});
    if (route !== activeRoute) { editorBar.hidden = true;return; }
    editor.active = true;
    editor.ready = true;
    editor.route = route;
    document.body.classList.add('document-editing');
    document.querySelector('.highlight-toolbar').hidden = true;
    searchInput.disabled = true;
    editButton.textContent = '退出编辑';
    editorBar.querySelector('#editor-path').textContent = result.path;
    let groups = [group];
    if (route === 'architecture') groups = ['architecture', ...DATA.architecture.nodes.map(node => 'arch-' + node.id), ...Object.keys(DATA.architecture.traces).map(id => 'trace-' + id)];
    editorGroup.innerHTML = editorGroups.filter(item => groups.includes(item.id)).map(item => `<option value="${item.id}">${escapeHTML(item.title)}</option>`).join('');
    editorGroup.value = group;
    editorBar.querySelector('#editor-group-label').hidden = groups.length < 2;
    mountEditorFields(preview);
    editor.dirty = !sameEdits(editor.draft, editor.base) || Object.keys(editor.rich).length > 0;
    editorMessage(editor.dirty ? '已恢复未保存草稿；确认后保存到本地' : '点击正文即可修改，保存只写入本地文件');
    if (editor.revision !== result.revision) editorMessage('草稿对应的文件已更新；请下载草稿备份，再载入最新文件合并。', true);
  } catch (error) {
    if (editor.active) {
      editor.busy = false;
      leaveEditorForNavigation();
      renderRoute();
    }
    editorBar.hidden = false;
    editorMessage(error.message, true);
  } finally { editor.busy = false;updateEditorControls(); }
}
function leaveEditorForNavigation() {
  if (!editor.active) { editorBar.hidden = true;return true; }
  if (editor.busy) { history.replaceState(null, '', '#' + editor.route);return false; }
  persistEditorDraft();
  for (const instance of editor.instances.values()) if (!instance.plain) instance.view.destroy();
  editor.instances.clear();
  editor.focus = null;
  editor.active = false;
  editor.ready = false;
  editorBar.hidden = true;
  document.body.classList.remove('document-editing');
  searchInput.disabled = !currentProject().ready;
  editButton.textContent = '编辑内容';
  return true;
}
function closeEditor() {
  if (editor.busy) return;
  const top = scrollY;
  leaveEditorForNavigation();
  renderRoute();
  window.scrollTo({top, behavior: 'instant'});
}
function reloadLocalReading() {
  // This reload is triggered after a successful local write, so it must not look like data loss.
  editor.reloading = true;
  sessionStorage.setItem('nico-local-save-scroll', String(scrollY));
  location.reload();
}
async function saveEditor(event) {
  event?.preventDefault();
  if (editor.busy || !editor.ready || !editor.dirty) return;
  editor.busy = true;
  updateEditorControls();
  editorMessage('正在保存到本地 Markdown…');
  try {
    const result = await localRequest('save-rich', {group: editor.group, revision: editor.revision, values: editor.draft, rich: editor.rich});
    editor.dirty = false;
    persistEditorDraft();
    showPublishStatus(result);
    sessionStorage.setItem(resumeEditorKey, editor.group);
    reloadLocalReading();
  } catch (error) {
    persistEditorDraft();
    editorMessage(error.message, true);
  } finally { editor.busy = false;updateEditorControls(); }
}
function runEditorCommand(action) {
  const instance = editor.focus;
  if (editor.busy || !instance || instance.plain) return;
  if (action === 'image') { chooseEditorImage(instance);return; }
  HandbookRichEditor.command(instance.view, action);
  updateEditorControls();
}
function chooseEditorImage(instance) {
  const selection = {from: instance.view.state.selection.from, to: instance.view.state.selection.to};
  const picker = document.createElement('input');
  picker.type = 'file';picker.accept = 'image/png,image/jpeg,image/webp';
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { editorMessage('请选择 5 MB 以内的图片。', true);return; }
    const caption = prompt('图片说明', file.name.replace(/\.[^.]+$/, ''));
    if (caption === null) return;
    editor.busy = true;updateEditorControls();
    editorMessage('正在保存本地图片…');
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('无法读取图片，请重试。'));
        reader.readAsDataURL(file);
      });
      const result = await localRequest('upload-image', {data});
      instance.view.chain().setTextSelection(selection).insertContent({type: 'image', attrs: {
        src: 'media/' + result.path.split('/').at(-1), alt: caption.replace(/\s+/g, ' ').slice(0, 300)
      }}).run();
      showPublishStatus(result);
      editorMessage('图片已插入草稿，保存到本地后成为正文内容');
    } catch (error) { editorMessage(error.message, true); }
    finally { editor.busy = false;updateEditorControls(); }
  });
  picker.click();
}
function formatTargetForSelection(parts) {
  if (!localEditing || editor.active || parts.length !== 1) return null;
  const part = parts[0];
  const field = DATA.editorFields.find(item => item.key === part.block.dataset.highlightKey && item.multiline);
  if (!field || !DATA.appendTargets[field.key]) return null;
  return {...part, field};
}

async function saveSelectionFormat(target, style) {
  if (!target || editor.busy || publishing || appendState.busy) return;
  if (readEditorDrafts()[target.field.group]) {
    notify('本篇有未保存的编辑草稿，请先在顶部编辑中保存后再划词排版。');
    return;
  }
  editor.busy = true;
  updateEditorControls();
  notify('正在保存文字样式到本地…');
  try {
    const result = await localRequest('format', {group: target.field.group, field: target.field.key,
      revision: DATA.documentRevisions[target.field.group], start: target.start, end: target.end,
      quote: target.quote, style});
    showPublishStatus(result);
    reloadLocalReading();
  } catch (error) { notify(error.message); }
  finally { editor.busy = false; updateEditorControls(); }
}

const imageDialog = document.createElement('dialog');
imageDialog.className = 'image-viewer';
imageDialog.setAttribute('aria-label', '查看图片');
imageDialog.innerHTML = '<button type="button" class="btn" autofocus>关闭图片</button><img alt=""><p></p>';
document.body.append(imageDialog);
imageDialog.querySelector('button').addEventListener('click', () => imageDialog.close());
imageDialog.addEventListener('click', event => { if (event.target === imageDialog) imageDialog.close(); });
function openReadingImage(image) {
  const enlarged = imageDialog.querySelector('img');
  enlarged.src = image.src;
  enlarged.alt = image.alt;
  imageDialog.querySelector('p').textContent = image.alt;
  imageDialog.showModal();
}
document.addEventListener('click', event => {
  const image = event.target.closest('main .reading-image');
  if (image && !editor.active && !window.getSelection()?.toString()) openReadingImage(image);
});
document.addEventListener('keydown', event => {
  if (!editor.active && event.target.matches('main .reading-image') && ['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    openReadingImage(event.target);
  }
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
editorBar.querySelectorAll('[data-editor-format]').forEach(button => {
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => runEditorCommand(button.dataset.editorFormat));
});
editorBar.querySelector('#editor-text-style').addEventListener('change', event => runEditorCommand(event.target.value));
editorBar.querySelector('#editor-save').addEventListener('click', saveEditor);
editorBar.querySelector('#editor-close').addEventListener('click', closeEditor);
editorGroup.addEventListener('change', async () => {
  const group = editorGroup.value;
  closeEditor();
  await openEditor(group);
});
editorBar.querySelector('#editor-reload').addEventListener('click', async () => {
  if (editor.dirty && !confirm('载入最新文件会放弃未保存草稿，请先下载备份。继续吗？')) return;
  const group = editor.group;
  editor.dirty = false;persistEditorDraft();
  closeEditor();
  await openEditor(group);
});
editorBar.querySelector('#editor-export').addEventListener('click', async () => {
  let text, extension = 'md';
  try {
    const prepared = await localRequest('editor-preview', {group: editor.group, values: editor.draft, rich: editor.rich});
    text = DATA.editorFields.filter(field => field.group === editor.group).map(field => '## ' + field.label + '\n\n' + prepared.values[field.key]).join('\n\n');
  } catch {
    text = JSON.stringify({group: editor.group, values: editor.draft, rich: editor.rich, revision: editor.revision}, null, 2);
    extension = 'json';
    editorMessage('暂时无法转换 Markdown，已改为下载包含完整富文本的草稿备份。');
  }
  const url = URL.createObjectURL(new Blob([text], {type: 'text/plain;charset=utf-8'}));
  const link = document.createElement('a');link.href = url;link.download = editor.group + '-草稿.' + extension;link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
editorBar.querySelector('#editor-open-file').addEventListener('click', async () => {
  if (editor.busy || editor.dirty) return;
  editor.busy = true;updateEditorControls();
  try {
    await localRequest('open-document', {group: editor.group});
    editorMessage('已打开原文件；外部保存后，请载入最新文件再继续编辑。');
  } catch (error) { editorMessage(error.message, true); }
  finally { editor.busy = false;updateEditorControls(); }
});
document.addEventListener('click', event => {
  if (event.target.closest('[data-action="edit-page"]')) {
    if (editor.active) closeEditor();
    else openEditor();
  }
  if (editor.active && event.target.closest('summary .document-field')) event.preventDefault();
});
document.addEventListener('keydown', event => {
  if (!editor.active || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
  event.preventDefault();saveEditor();
}, true);
window.addEventListener('beforeunload', event => {
  if (editor.active) persistEditorDraft();
  if ((editor.busy || publishing) && !editor.reloading) { event.preventDefault();event.returnValue = ''; }
});
new ResizeObserver(entries => {
  document.documentElement.style.setProperty('--topbar-height', entries[0].target.getBoundingClientRect().height + 'px');
}).observe(document.querySelector('.topbar'));
window.addEventListener('load', async () => {
  const group = sessionStorage.getItem(resumeEditorKey);
  const position = sessionStorage.getItem('nico-local-save-scroll');
  sessionStorage.removeItem(resumeEditorKey);
  sessionStorage.removeItem('nico-local-save-scroll');
  if (group && localEditing) await openEditor(group);
  if (position !== null) {
    window.scrollTo({top: Number(position), behavior: 'instant'});
    if (group) editorMessage('已保存到本地，可继续直接编辑');
    else notify('已保存到本地，阅读内容已更新。');
  }
});
