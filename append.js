const appendState = {target: null, busy: false, saved: false, history: [], composedTurns: 0, stale: false, controller: null};
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
  <header class="editor-heading"><div><span class="eyebrow">边学边问</span><h2 id="append-title">追问并补充知识点</h2></div><button type="button" class="btn small" id="append-close">关闭</button></header>
  <div class="editor-body">
    <p id="append-location" class="editor-help"></p>
    <p class="editor-help">围绕选中文字向 AI 追问，满意后整理成补充内容。只有点击「确认追加并保存」，才会写入原段落之后。</p>
    <blockquote id="append-selection" aria-label="选中的原文"></blockquote>
    <div id="append-conversation" role="log" aria-label="追问对话" aria-live="polite"></div>
    <form id="append-ask-form"><label>你的追问<textarea id="append-question" rows="3" maxlength="2000" required placeholder="例如：能举个实际案例吗？这里具体怎么做？"></textarea></label><div class="actions"><button type="submit" class="btn primary" id="append-ask">发送追问</button><button type="button" class="btn" id="append-compose">整理为补充内容</button><button type="button" class="text-button" id="append-reset">重新开始</button><button type="button" class="text-button" id="append-cancel" hidden>停止等待</button></div></form>
    <section id="append-result" hidden>
    <form id="append-form"><label>补充内容（保存前可修改）<textarea id="append-input" rows="5" maxlength="20000" required placeholder="AI 整理的补充内容会显示在这里，你可以修改后再保存。"></textarea></label></form>
    <section class="append-preview" aria-label="追加效果预览"><h3>追加效果预览</h3><div id="append-original" class="prose"></div><div class="append-insertion"><span>新增内容</span><div id="append-preview-text" class="prose"></div></div></section>
    </section>
    <p id="append-status" role="status" aria-live="polite"></p>
  </div>
  <footer class="editor-footer"><button type="button" class="text-button" id="append-backup">下载补充草稿</button><button type="submit" form="append-form" class="btn primary" id="append-save">确认追加并保存</button></footer>`;
document.body.append(appendDialog);
const appendInput = appendDialog.querySelector('#append-input');
const appendQuestion = appendDialog.querySelector('#append-question');
const appendConversation = appendDialog.querySelector('#append-conversation');

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
  const unavailable = Boolean(appendState.busy || appendState.saved || appendState.stale);
  appendDialog.querySelectorAll('button,input,textarea').forEach(control => { control.disabled = Boolean(appendState.busy); });
  appendInput.disabled = unavailable;
  appendQuestion.disabled = unavailable;
  appendDialog.querySelector('#append-ask').disabled = unavailable || !appendQuestion.value.trim() || appendState.history.length >= 24;
  appendDialog.querySelector('#append-compose').disabled = unavailable || !appendState.history.length;
  appendDialog.querySelector('#append-save').disabled = unavailable || !appendInput.value.trim() || appendState.composedTurns !== appendState.history.length;
  const generating = ['ask', 'compose'].includes(appendState.busy);
  appendDialog.querySelector('#append-cancel').hidden = !generating;
  appendDialog.querySelector('#append-cancel').disabled = !generating;
  appendDialog.querySelector('#append-save').textContent = appendState.busy === 'save' ? '正在保存…' : '确认追加并保存';
  appendDialog.querySelector('#append-ask').textContent = appendState.busy === 'ask' ? '正在回答…' : '发送追问';
  appendDialog.querySelector('#append-compose').textContent = appendState.busy === 'compose' ? '正在整理…' : '整理为补充内容';
  appendDialog.setAttribute('aria-busy', String(Boolean(appendState.busy)));
}

function renderAppendConversation() {
  appendConversation.replaceChildren();
  for (const message of appendState.history) {
    const article = document.createElement('article');
    article.className = 'append-message ' + message.role;
    const label = document.createElement('strong');
    label.textContent = message.role === 'user' ? '你的追问' : 'AI 回答';
    const text = document.createElement('div');
    text.className = 'prose';
    text.textContent = message.content;
    article.append(label, text);
    appendConversation.append(article);
  }
}

function renderAppendPreview() {
  appendDialog.querySelector('#append-result').hidden = !appendInput.value;
  appendDialog.querySelector('#append-preview-text').textContent = appendInput.value;
  updateTermNotes(appendInput);
}

function openAppend(target) {
  if (!target || editor.busy || publishing || appendState.busy) { notify('请等待当前操作完成后再追问。'); return; }
  appendState.target = target;
  appendState.saved = false;
  const chapter = DATA.chapters.find(item => item.id === target.field.group);
  appendDialog.querySelector('#append-location').textContent = `${chapter?.short || '知识点'} / ${target.field.label}`;
  appendDialog.querySelector('#append-original').textContent = target.paragraph;
  appendDialog.querySelector('#append-selection').textContent = target.quote;
  const stored = appendDrafts[target.draftKey];
  const draft = typeof stored === 'string' ? {addition: stored} : stored || {};
  appendState.history = Array.isArray(draft.history) ? draft.history.filter(message => ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string') : [];
  appendState.composedTurns = draft.composedTurns || 0;
  appendState.stale = Boolean(draft.source && (draft.source !== target.source || draft.quote !== target.quote));
  appendInput.value = typeof draft.addition === 'string' ? draft.addition : '';
  appendQuestion.value = typeof draft.question === 'string' ? draft.question : '';
  renderAppendConversation();
  renderAppendPreview();
  appendMessage(appendState.stale ? '原文或选中文字已变化。旧草稿已保留，请下载备份，再点击「重新开始」。' : '可以连续追问，回答不会自动写入原文。整理后可修改，确认保存才会更新本地 Markdown。', appendState.stale);
  updateAppendControls();
  appendDialog.showModal();
  appendQuestion.focus();
}

function persistAppendDraft() {
  if (!appendState.target) return;
  const target = appendState.target;
  if (!appendState.saved && (appendInput.value.trim() || appendQuestion.value.trim() || appendState.history.length)) {
    // Retain stale anchors until the user explicitly starts a fresh conversation.
    const old = appendDrafts[target.draftKey];
    appendDrafts[target.draftKey] = {addition: appendInput.value, question: appendQuestion.value,
      history: appendState.history, composedTurns: appendState.composedTurns,
      source: appendState.stale ? old.source : target.source, quote: appendState.stale ? old.quote : target.quote};
  } else delete appendDrafts[target.draftKey];
  try { localStorage.setItem(appendDraftKey, JSON.stringify(appendDrafts)); }
  catch { appendMessage('草稿暂存在当前页面；浏览器无法保存，请在关闭网页前下载备份。', true); }
}

async function requestAppendAnswer(mode) {
  if (appendState.busy || appendState.stale || appendState.saved) return;
  const question = appendQuestion.value.trim();
  if ((mode === 'ask' && (!question || appendState.history.length >= 24)) || (mode === 'compose' && !appendState.history.length)) return;
  if (mode === 'compose' && appendInput.value.trim() && !confirm('重新整理会替换当前补充预览。需要保留手动修改时，请先下载草稿。继续吗？')) return;
  const target = appendState.target;
  appendState.busy = mode;
  appendState.controller = new AbortController();
  persistAppendDraft();
  updateAppendControls();
  appendMessage(mode === 'ask' ? '正在结合当前知识点回答，请稍候…' : '正在把追问内容整理成补充段落…');
  try {
    const result = await localRequest('followup', {group: target.field.group, field: target.field.key,
      revision: DATA.documentRevisions[target.field.group], quote: target.quote,
      mode, question, history: appendState.history}, appendState.controller.signal);
    if (typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('没有收到完整回答，请重试。');
    if (mode === 'ask') {
      appendState.history.push({role: 'user', content: question}, {role: 'assistant', content: result.answer});
      appendQuestion.value = '';
      renderAppendConversation();
      appendMessage('可以继续追问，或点击「整理为补充内容」。新对话需要重新整理后才能保存。');
      appendConversation.lastElementChild?.scrollIntoView({block: 'nearest'});
    } else {
      appendInput.value = result.answer;
      appendState.composedTurns = appendState.history.length;
      renderAppendPreview();
      appendMessage('已生成补充预览，可修改。确认保存后才会写入原段落之后。');
      appendInput.scrollIntoView({block: 'nearest'});
    }
    persistAppendDraft();
  } catch (error) {
    if (error.name === 'AbortError') appendMessage('已停止等待，草稿已保留。发出的模型请求可能仍在处理。');
    else if (error.name === 'TimeoutError') appendMessage('模型响应超时，草稿已保留，可稍后手动重试。', true);
    else appendMessage(error.message, true);
  } finally {
    appendState.busy = false;
    appendState.controller = null;
    updateAppendControls();
  }
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
  const block = '> [!SUPPLEMENT]\n> ' + paragraphs.join('\n\n').replace(/\n/g, '\n> ');
  return before + '\n\n' + block + (after ? '\n\n' + after : '');
}

async function saveAppend(event) {
  event.preventDefault();
  if (appendState.busy || appendState.saved || appendState.stale || !appendInput.value.trim() || appendState.composedTurns !== appendState.history.length) return;
  const target = appendState.target;
  appendState.busy = 'save';
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
  appendDialog.querySelector('#append-preview-text').textContent = appendInput.value;
  updateTermNotes(appendInput);
  persistAppendDraft();
  updateAppendControls();
});
appendQuestion.addEventListener('input', () => { persistAppendDraft(); updateAppendControls(); });
appendDialog.querySelector('#append-ask-form').addEventListener('submit', event => { event.preventDefault(); requestAppendAnswer('ask'); });
appendDialog.querySelector('#append-compose').addEventListener('click', () => requestAppendAnswer('compose'));
appendDialog.querySelector('#append-cancel').addEventListener('click', () => appendState.controller?.abort());
appendDialog.querySelector('#append-reset').addEventListener('click', () => {
  if (appendState.busy || !confirm('清空当前追问和补充草稿，重新开始吗？需要保留时请先下载草稿。')) return;
  delete appendDrafts[appendState.target.draftKey];
  resetAppend();
});
function resetAppend() {
  appendState.history = [];
  appendState.stale = false;
  appendState.composedTurns = 0;
  appendQuestion.value = '';
  appendInput.value = '';
  persistAppendDraft();
  renderAppendConversation();
  renderAppendPreview();
  updateAppendControls();
  appendMessage('已清空草稿，可以围绕选中文字重新追问。');
  appendQuestion.focus();
}
appendDialog.querySelector('#append-form').addEventListener('submit', saveAppend);
appendDialog.querySelector('#append-close').addEventListener('click', closeAppend);
appendDialog.addEventListener('cancel', event => { event.preventDefault(); closeAppend(); });
appendDialog.querySelector('#append-backup').addEventListener('click', () => {
  const conversation = appendState.history.map(message => (message.role === 'user' ? '追问：' : '回答：') + message.content).join('\n\n');
  const content = `位置：${appendDialog.querySelector('#append-location').textContent}\n\n原段落：\n${appendState.target.paragraph}\n\n追问对话：\n${conversation}\n\n尚未发送的问题：\n${appendQuestion.value}\n\n补充预览：\n${appendInput.value}`;
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
