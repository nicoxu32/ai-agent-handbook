const appendState = {target: null, busy: false, saved: false};
const appendDraftKey = 'nico-handbook-append-drafts-v1';
let appendDrafts = {};
try {
  const savedDrafts = JSON.parse(localStorage.getItem(appendDraftKey) || '{}');
  if (savedDrafts && typeof savedDrafts === 'object' && !Array.isArray(savedDrafts)) appendDrafts = savedDrafts;
} catch { /* Drafts can still live in memory when browser storage is unavailable. */ }
const appendDialog = document.createElement('dialog');
appendDialog.className = 'content-editor append-editor';
appendDialog.setAttribute('aria-labelledby', 'append-title');
appendDialog.innerHTML = `
  <header class="editor-heading"><div><span class="eyebrow">补充知识</span><h2 id="append-title">追加到知识点</h2></div><button type="button" class="btn small" id="append-close">关闭</button></header>
  <div class="editor-body">
    <p id="append-location" class="editor-help"></p>
    <p class="editor-help">补充内容作为新段落放在选中段落之后。选中列表或表格时，放在完整列表或表格之后。</p>
    <blockquote id="append-selection" aria-label="选中的原文"></blockquote>
    <form id="append-form"><label>补充内容<textarea id="append-input" rows="5" maxlength="20000" required placeholder="写下补充解释、例子或容易忽略的细节，换行可分段。"></textarea></label></form>
    <section class="append-preview" aria-label="追加效果预览"><h3>追加效果预览</h3><div id="append-original" class="prose"></div><div class="append-insertion"><span>新增内容</span><div id="append-preview-text" class="prose"></div></div></section>
    <p id="append-status" role="status" aria-live="polite"></p>
  </div>
  <footer class="editor-footer"><button type="button" class="text-button" id="append-backup">下载补充草稿</button><button type="submit" form="append-form" class="btn primary" id="append-save">确认追加并保存</button></footer>`;
document.body.append(appendDialog);
const appendInput = appendDialog.querySelector('#append-input');

function appendTargetForSelection(parts) {
  if (!localEditing || parts.length !== 1) return null;
  const part = parts[0];
  const key = part.block.dataset.highlightKey;
  const records = DATA.appendTargets[key];
  const field = DATA.editorFields.find(item => item.key === key);
  if (!records || !field?.multiline) return null;
  for (const node of part.block.querySelectorAll('[data-append-index]')) {
    const before = document.createRange();
    before.selectNodeContents(part.block);
    before.setEndBefore(node);
    if (part.end <= before.toString().length) return null;
    before.setEndAfter(node);
    if (before.toString().length < part.end) continue;
    const record = records[Number(node.dataset.appendIndex)];
    if (!record || record.text !== node.textContent) return null;
    return {field, end: record.end, paragraph: record.text, quote: part.quote,
      source: editableValue(field, DATA.edits), draftKey: key + '@' + record.end};
  }
  return null;
}

function appendMessage(message, error = false) {
  const status = appendDialog.querySelector('#append-status');
  status.textContent = message;
  status.classList.toggle('error', error);
}

function updateAppendControls() {
  appendDialog.querySelectorAll('button,input,textarea').forEach(control => { control.disabled = appendState.busy; });
  appendInput.disabled = appendState.busy || appendState.saved;
  appendDialog.querySelector('#append-save').disabled = appendState.busy || appendState.saved || !appendInput.value.trim();
  let saveLabel = '确认追加并保存';
  if (appendState.busy) saveLabel = '正在处理…';
  else if (appendState.saved) saveLabel = '已保存到本地';
  appendDialog.querySelector('#append-save').textContent = saveLabel;
}

function openAppend(target) {
  if (!target || editor.busy) { notify('请等待当前保存完成后再追加。'); return; }
  appendState.target = target;
  appendState.saved = false;
  const chapter = DATA.chapters.find(item => item.id === target.field.group);
  appendDialog.querySelector('#append-location').textContent = `${chapter?.short || '知识点'} / ${target.field.label}`;
  appendDialog.querySelector('#append-original').textContent = target.paragraph;
  appendDialog.querySelector('#append-selection').textContent = target.quote;
  appendInput.value = typeof appendDrafts[target.draftKey] === 'string' ? appendDrafts[target.draftKey] : '';
  appendDialog.querySelector('#append-preview-text').textContent = appendInput.value || '填写后，这里会显示追加的段落。';
  appendMessage('确认后写入电脑里的 Markdown 文件，并立即更新阅读内容。稍后可从编辑窗口统一发布。');
  updateTermNotes(appendInput);
  updateAppendControls();
  appendDialog.showModal();
  appendInput.focus();
}

function persistAppendDraft() {
  if (!appendState.target) return;
  const key = appendState.target.draftKey;
  if (appendInput.value.trim() && !appendState.saved) appendDrafts[key] = appendInput.value;
  else delete appendDrafts[key];
  try { localStorage.setItem(appendDraftKey, JSON.stringify(appendDrafts)); }
  catch { appendMessage('草稿暂存在当前页面；浏览器无法保存，请在关闭网页前下载备份。', true); }
}

function closeAppend() {
  if (appendState.busy) return;
  persistAppendDraft();
  appendDialog.close();
}

function appendedMarkdown(target, addition) {
  // Treat the added text as prose, so markup characters cannot alter adjacent blocks.
  const paragraphs = addition.trim().split(/\n\s*\n/).map(paragraph =>
    paragraph.replace(/([\\`*_{}\[\]#+.!|()-])/g, '\\$1').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '  \n'));
  const before = target.source.slice(0, target.end).replace(/\n+$/, '');
  const after = target.source.slice(target.end).replace(/^\n+/, '');
  return before + '\n\n' + paragraphs.join('\n\n') + (after ? '\n\n' + after : '');
}

async function saveAppend(event) {
  event.preventDefault();
  if (appendState.busy || appendState.saved || !appendInput.value.trim()) return;
  const target = appendState.target;
  appendState.busy = true;
  updateAppendControls();
  appendMessage('正在核对文件版本并保存追加内容…');
  try {
    const latest = await localRequest('document', {group: target.field.group});
    if (latest.revision !== DATA.documentRevisions[target.field.group] || latest.values[target.field.key] !== target.source) {
      throw new Error('原文文件已有更新，尚未追加。补充草稿已保留，请刷新后重新选择位置。');
    }
    await localRequest('save', {group: target.field.group, revision: latest.revision,
      values: {...latest.values, [target.field.key]: appendedMarkdown(target, appendInput.value)}});
    appendState.saved = true;
    persistAppendDraft();
    reloadLocalReading();
  } catch (error) {
    persistAppendDraft();
    appendMessage(error.message, true);
  } finally {
    appendState.busy = false;
    updateAppendControls();
  }
}

appendInput.addEventListener('input', () => {
  appendDialog.querySelector('#append-preview-text').textContent = appendInput.value || '填写后，这里会显示追加的段落。';
  updateTermNotes(appendInput);
  persistAppendDraft();
  updateAppendControls();
});
appendDialog.querySelector('#append-form').addEventListener('submit', saveAppend);
appendDialog.querySelector('#append-close').addEventListener('click', closeAppend);
appendDialog.addEventListener('cancel', event => { event.preventDefault(); closeAppend(); });
appendDialog.querySelector('#append-backup').addEventListener('click', () => {
  const content = `位置：${appendDialog.querySelector('#append-location').textContent}\n\n原段落：\n${appendState.target.paragraph}\n\n补充：\n${appendInput.value}`;
  const url = URL.createObjectURL(new Blob([content], {type: 'text/plain;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = '知识点补充草稿.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('beforeunload', event => {
  if (appendState.busy) { event.preventDefault(); event.returnValue = ''; }
});
