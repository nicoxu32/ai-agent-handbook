const appendState = {target: null, busy: false, history: [], composedTurns: 0, stale: false, controller: null, open: false, partial: '', undo: null, answerDrafts: {}};
const appendDraftKey = 'nico-handbook-append-drafts-v1';
let appendDrafts = {};
try {
  const savedDrafts = JSON.parse(localStorage.getItem(appendDraftKey) || '{}');
  if (savedDrafts && typeof savedDrafts === 'object' && !Array.isArray(savedDrafts)) appendDrafts = savedDrafts;
} catch { /* Drafts can still live in memory when browser storage is unavailable. */ }
const appendDialog = document.createElement('aside');
appendDialog.className = 'content-editor append-editor';
appendDialog.setAttribute('aria-labelledby', 'append-title');
appendDialog.hidden = true;
appendDialog.innerHTML = `
  <header class="editor-heading"><div><span class="eyebrow">边学边问</span><h2 id="append-title">边读边追问</h2></div><button type="button" class="btn small" id="append-close">收起</button></header>
  <div class="append-resize" role="separator" tabindex="0" aria-label="调整追问栏宽度" aria-orientation="vertical"></div>
  <div class="editor-body">
    <div class="append-anchor"><p id="append-location" class="editor-help"></p><button type="button" class="text-button" id="append-locate">定位原文 ↗</button></div>
    <p class="editor-help">左侧继续阅读，右侧随时追问。回答可修改后直接插入，也可整理多轮对话再插入。</p>
    <blockquote id="append-selection" aria-label="选中的原文"></blockquote>
    <div id="append-conversation" role="log" aria-label="追问对话" aria-live="polite"></div>
    <form id="append-ask-form"><label>你的追问<textarea id="append-question" rows="3" maxlength="2000" required placeholder="例如：能举个实际案例吗？这里具体怎么做？"></textarea></label><div class="actions"><button type="submit" class="btn primary" id="append-ask">发送追问</button><button type="button" class="btn" id="append-compose">整理本轮对话</button><button type="button" class="text-button" id="append-reset">重新开始</button><button type="button" class="text-button" id="append-cancel" hidden>停止等待</button></div></form>
    <section id="append-result" hidden>
    <form id="append-form"><label>补充内容（保存前可修改）<textarea id="append-input" rows="5" maxlength="20000" required placeholder="AI 整理的补充内容会显示在这里，你可以修改后再保存。"></textarea></label></form>
    <section class="append-preview" aria-label="追加效果预览"><h3>追加效果预览</h3><div id="append-original" class="prose"></div><div class="append-insertion"><span>新增内容</span><div id="append-preview-text" class="prose"></div></div></section>
    </section>
    <p id="append-status" role="status" aria-live="polite"></p>
  </div>
  <footer class="editor-footer"><button type="button" class="text-button" id="append-undo" hidden>撤销本次插入</button><button type="button" class="text-button" id="append-backup">下载补充草稿</button><button type="submit" form="append-form" class="btn primary" id="append-save">插入补充并保存</button></footer>`;
document.body.append(appendDialog);
const appendToggle = document.createElement('button');
appendToggle.type = 'button';
appendToggle.className = 'btn append-toggle';
appendToggle.hidden = true;
appendToggle.textContent = '继续追问';
appendToggle.setAttribute('aria-controls', 'append-panel');
appendDialog.id = 'append-panel';
document.body.append(appendToggle);
appendToggle.addEventListener('click', () => showAppendPanel());
const appendMobileSwitch = document.createElement('nav');
appendMobileSwitch.className = 'append-mobile-switch';
appendMobileSwitch.setAttribute('aria-label', '切换阅读与追问');
appendMobileSwitch.hidden = true;
appendMobileSwitch.innerHTML = '<button type="button" data-append-view="reading">原文</button><button type="button" data-append-view="chat">追问</button>';
document.body.append(appendMobileSwitch);
appendMobileSwitch.addEventListener('click', event => {
  const view = event.target.closest('[data-append-view]')?.dataset.appendView;
  if (view === 'reading') closeAppend();
  if (view === 'chat') showAppendPanel();
});

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
  const unavailable = Boolean(appendState.busy || appendState.stale);
  appendDialog.querySelectorAll('button,input,textarea').forEach(control => { control.disabled = unavailable; });
  appendInput.disabled = unavailable;
  appendQuestion.disabled = unavailable;
  appendDialog.querySelector('#append-ask').disabled = unavailable || !appendQuestion.value.trim() || appendState.history.length >= 24;
  appendDialog.querySelector('#append-compose').disabled = unavailable || !appendState.history.length;
  appendDialog.querySelector('#append-save').disabled = unavailable || !appendInput.value.trim() || appendState.composedTurns !== appendState.history.length || editor.active;
  const generating = ['ask', 'compose'].includes(appendState.busy);
  appendDialog.querySelector('#append-cancel').hidden = !generating;
  appendDialog.querySelector('#append-cancel').disabled = !generating;
  appendDialog.querySelector('#append-close').disabled = false;
  appendDialog.querySelector('#append-locate').disabled = false;
  appendDialog.querySelector('#append-backup').disabled = false;
  appendDialog.querySelector('#append-undo').hidden = !appendState.undo;
  appendDialog.querySelector('#append-save').textContent = appendState.busy === 'save' ? '正在保存…' : '插入补充并保存';
  appendDialog.querySelector('#append-ask').textContent = appendState.busy === 'ask' ? '正在回答…' : '发送追问';
  appendDialog.querySelector('#append-compose').textContent = appendState.busy === 'compose' ? '正在整理…' : '整理本轮对话';
  appendDialog.setAttribute('aria-busy', String(Boolean(appendState.busy)));
  appendToggle.textContent = generating ? '回答生成中 · 查看' : '继续追问';
  appendMobileSwitch.querySelector('[data-append-view="chat"]').textContent = generating ? '追问 · 生成中' : '追问';
}

function renderAppendConversation() {
  appendConversation.replaceChildren();
  for (const [index, message] of appendState.history.entries()) {
    const article = document.createElement('article');
    article.className = 'append-message ' + message.role;
    const label = document.createElement('strong');
    label.textContent = message.role === 'user' ? '你的追问' : 'AI 回答 · 可直接修改';
    const text = document.createElement(message.role === 'user' ? 'div' : 'textarea');
    text.className = 'prose';
    if (message.role === 'user') text.textContent = message.content;
    else {
      text.value = appendState.answerDrafts[index] ?? message.content;
      text.rows = Math.min(16, Math.max(5, Math.ceil(text.value.length / 24)));
      text.maxLength = 20000;
      text.setAttribute('aria-label', '修改这条回答');
      text.addEventListener('input', () => { appendState.answerDrafts[index] = text.value;persistAppendDraft(); });
      const insert = document.createElement('button');
      insert.type = 'button';insert.className = 'btn small';insert.textContent = '插入原文 ↓';
      insert.addEventListener('click', () => saveAppend(null, text.value));
      article.append(label, text, insert);
    }
    if (message.role === 'user') article.append(label, text);
    appendConversation.append(article);
  }
}

function renderPartialAnswer() {
  let partial = appendConversation.querySelector('.append-partial');
  if (!partial) {
    partial = document.createElement('article');
    partial.className = 'append-message assistant append-partial';
    partial.innerHTML = '<strong></strong><div class="prose"></div>';
    appendConversation.append(partial);
  }
  partial.querySelector('strong').textContent = appendState.busy ? 'AI 正在回答…' : '未完成的回答 · 仅作草稿';
  partial.querySelector('.prose').textContent = appendState.partial;
}

async function readFollowupStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', result;
  try {
    while (true) {
      const {value, done} = await reader.read();
      buffer += decoder.decode(value, {stream: !done});
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim();buffer = buffer.slice(end + 1);
        if (!line.startsWith('data:')) continue;
        const event = JSON.parse(line.slice(5));
        if (event.type === 'error') throw new Error(event.error);
        if (event.type === 'delta') onDelta(event.text);
        if (event.type === 'done') result = event;
      }
      if (done) break;
    }
    if (!result) throw new Error('回答连接中断，已收到的内容保留为草稿，不能直接插入。');
    return result;
  } finally { reader.releaseLock(); }
}

function showAppendPanel() {
  appendState.open = true;
  appendDialog.hidden = false;
  appendToggle.hidden = true;
  document.body.classList.add('append-layout');
  document.body.classList.add('append-session');
  appendMobileSwitch.hidden = false;
  appendMobileSwitch.querySelector('[data-append-view="chat"]').setAttribute('aria-current', 'page');
  appendMobileSwitch.querySelector('[data-append-view="reading"]').removeAttribute('aria-current');
  setMenu(false);
}

function locateAppendSource() {
  const target = appendState.target;
  if (!target) return;
  const chapter = DATA.chapters.find(item => item.questions.some(question => 'question/' + question.id + '/answer' === target.field.key));
  const route = chapter?.id || target.field.group;
  if (activeRoute !== route) go(route);
  const block = [...main.querySelectorAll('[data-highlight-key]')].find(node => node.dataset.highlightKey === target.field.key);
  if (!block) return;
  const node = [...block.querySelectorAll('[data-append-index]')].find(node => DATA.appendTargets[target.field.key]?.[Number(node.dataset.appendIndex)]?.text === target.paragraph);
  const source = node || block;
  const details = source.closest('details');if (details) details.open = true;
  source.scrollIntoView({block: 'center', behavior: 'smooth'});
  source.classList.add('append-source-focus');
  setTimeout(() => source.classList.remove('append-source-focus'), 2000);
  if (innerWidth <= 760) closeAppend();
}

function renderAppendPreview() {
  appendDialog.querySelector('#append-result').hidden = !appendInput.value;
  appendDialog.querySelector('#append-preview-text').textContent = appendInput.value;
  updateTermNotes(appendInput);
}

function openAppend(target) {
  if (!target || editor.busy || publishing || appendState.busy) { notify('请等待当前操作完成后再追问。'); return; }
  persistAppendDraft();
  appendState.target = {...target, revision: DATA.documentRevisions[target.field.group]};
  appendState.partial = '';
  appendState.undo = null;
  const chapter = DATA.chapters.find(item => item.id === target.field.group);
  appendDialog.querySelector('#append-location').textContent = `${chapter?.short || '知识点'} / ${target.field.label}`;
  appendDialog.querySelector('#append-original').textContent = target.paragraph;
  appendDialog.querySelector('#append-selection').textContent = target.quote;
  const stored = appendDrafts[target.draftKey];
  const draft = typeof stored === 'string' ? {addition: stored} : stored || {};
  appendState.answerDrafts = draft.answerDrafts || {};
  appendState.partial = draft.partial || '';
  appendState.history = Array.isArray(draft.history) ? draft.history.filter(message => ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string') : [];
  appendState.composedTurns = draft.composedTurns || 0;
  appendState.stale = Boolean(draft.source && (draft.source !== target.source || draft.quote !== target.quote));
  appendInput.value = typeof draft.addition === 'string' ? draft.addition : '';
  appendQuestion.value = typeof draft.question === 'string' ? draft.question : '';
  renderAppendConversation();
  renderAppendPreview();
  appendMessage(appendState.stale ? '原文或选中文字已变化。旧草稿已保留，请下载备份，再点击「重新开始」。' : '可以连续追问，回答不会自动写入原文。整理后可修改，确认保存才会更新本地 Markdown。', appendState.stale);
  updateAppendControls();
  if (appendState.partial) renderPartialAnswer();
  showAppendPanel();
  appendQuestion.focus();
}

function persistAppendDraft() {
  if (!appendState.target) return;
  const target = appendState.target;
  if (appendInput.value.trim() || appendQuestion.value.trim() || appendState.history.length || appendState.partial) {
    // Retain stale anchors until the user explicitly starts a fresh conversation.
    const old = appendDrafts[target.draftKey];
    appendDrafts[target.draftKey] = {addition: appendInput.value, question: appendQuestion.value,
      history: appendState.history, answerDrafts: appendState.answerDrafts, partial: appendState.partial, composedTurns: appendState.composedTurns,
      source: appendState.stale ? old.source : target.source, quote: appendState.stale ? old.quote : target.quote};
  } else delete appendDrafts[target.draftKey];
  try { localStorage.setItem(appendDraftKey, JSON.stringify(appendDrafts)); }
  catch { appendMessage('草稿暂存在当前页面；浏览器无法保存，请在关闭网页前下载备份。', true); }
}

async function requestAppendAnswer(mode) {
  if (appendState.busy || appendState.stale) return;
  const question = appendQuestion.value.trim();
  if ((mode === 'ask' && (!question || appendState.history.length >= 24)) || (mode === 'compose' && !appendState.history.length)) return;
  if (mode === 'compose' && appendInput.value.trim() && !confirm('重新整理会替换当前补充预览。需要保留手动修改时，请先下载草稿。继续吗？')) return;
  const target = appendState.target;
  appendState.partial = '';
  appendConversation.querySelector('.append-partial')?.remove();
  appendState.busy = mode;
  appendState.controller = new AbortController();
  persistAppendDraft();
  updateAppendControls();
  appendMessage(mode === 'ask' ? '正在结合当前知识点回答，请稍候…' : '正在把追问内容整理成补充段落…');
  try {
    const result = await localRequest('followup', {group: target.field.group, field: target.field.key,
      revision: target.revision, quote: target.quote, stream: true,
      mode, question, history: appendState.history}, appendState.controller.signal, delta => {
        appendState.partial += delta;renderPartialAnswer();persistAppendDraft();
      });
    if (typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('没有收到完整回答，请重试。');
    appendState.partial = '';
    if (mode === 'ask') {
      appendState.history.push({role: 'user', content: question}, {role: 'assistant', content: result.answer});
      appendQuestion.value = '';
      renderAppendConversation();
      appendMessage('可修改这条回答并插入原文，也可继续追问，再整理本轮对话。');
      scrollAppendTo(appendConversation.lastElementChild);
    } else {
      appendInput.value = result.answer;
      appendState.composedTurns = appendState.history.length;
      renderAppendPreview();
      appendMessage('已生成补充预览，可修改。确认保存后才会写入原段落之后。');
      renderAppendConversation();
      scrollAppendTo(appendInput);
    }
    persistAppendDraft();
  } catch (error) {
    if (error.name === 'AbortError') appendMessage('已停止等待，草稿已保留。发出的模型请求可能仍在处理。');
    else if (error.name === 'TimeoutError') appendMessage('模型响应超时，草稿已保留，可稍后手动重试。', true);
    else appendMessage(error.message, true);
    const partial = appendConversation.querySelector('.append-partial strong');
    if (partial) partial.textContent = '未完成的回答 · 仅作草稿';
  } finally {
    persistAppendDraft();
    appendState.busy = false;
    appendState.controller = null;
    updateAppendControls();
  }
}

function scrollAppendTo(element) {
  if (!appendState.open || !element) return;
  const body = appendDialog.querySelector('.editor-body');
  body.scrollTop += element.getBoundingClientRect().top - body.getBoundingClientRect().top - 15;
}
function closeAppend() {
  persistAppendDraft();
  appendState.open = false;
  appendDialog.hidden = true;
  document.body.classList.remove('append-layout');
  sidebar.inert = innerWidth <= 760;
  appendToggle.hidden = !appendState.target;
  appendMobileSwitch.querySelector('[data-append-view="reading"]').setAttribute('aria-current', 'page');
  appendMobileSwitch.querySelector('[data-append-view="chat"]').removeAttribute('aria-current');
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

function applyAppendView(view, fieldKey, addition) {
  const top = scrollY;
  const details = [...main.querySelectorAll('details[open]')].map(node => node.querySelector('[data-highlight-key]')?.dataset.highlightKey);
  for (const [key, value] of Object.entries(view)) {
    if (Array.isArray(DATA[key])) DATA[key].splice(0, DATA[key].length, ...value);
    else DATA[key] = value;
  }
  allQuestions.splice(0, allQuestions.length, ...DATA.chapters.flatMap(chapter => chapter.questions.map(question => ({...question, chapter}))));
  if (typeof withChineseTerms === 'function') for (const chapter of DATA.chapters) chapter.search = withChineseTerms(chapter.search);
  if (searchInput.value) searchView(searchInput.value);
  else renderRoute();
  for (const key of details) {
    const block = [...main.querySelectorAll('[data-highlight-key]')].find(node => node.dataset.highlightKey === key);
    if (block?.closest('details')) block.closest('details').open = true;
  }
  window.scrollTo({top, behavior: 'instant'});
  if (addition) {
    const block = [...main.querySelectorAll('[data-highlight-key]')].find(node => node.dataset.highlightKey === fieldKey);
    const card = [...(block?.querySelectorAll('.callout-supplement') || [])].findLast(node => node.textContent.trim() === addition.trim());
    if (card) {
      card.classList.add('append-source-focus');
      setTimeout(() => card.classList.remove('append-source-focus'), 2500);
    }
  }
}
async function saveAppend(event, singleAnswer) {
  event?.preventDefault();
  const addition = (typeof singleAnswer === 'string' ? singleAnswer : appendInput.value).trim();
  if (appendState.busy || appendState.stale || !addition) return;
  if (typeof singleAnswer !== 'string' && appendState.composedTurns !== appendState.history.length) return;
  if (editor.active || editor.busy || publishing || readEditorDrafts()[appendState.target.field.group]) {
    appendMessage('请先保存并退出正文编辑，再插入补充，避免覆盖编辑草稿。', true);return;
  }
  const target = appendState.target;
  appendState.busy = 'save';updateAppendControls();
  appendMessage('正在核对文件版本并插入…');
  try {
    const latest = await localRequest('document', {group: target.field.group});
    if (latest.revision !== target.revision || latest.values[target.field.key] !== target.source) {
      throw new Error('原文文件已有更新，尚未追加。补充草稿已保留，请刷新后重新选择位置。');
    }
    const updated = appendedMarkdown(target, addition);
    const result = await localRequest('save', {group: target.field.group, revision: latest.revision,
      values: {...latest.values, [target.field.key]: updated}, includeView: true});
    appendState.undo = {group: target.field.group, revision: result.revision, values: latest.values, restoreRevision: latest.revision};
    applyAppendView(result.view, target.field.key, addition);
    target.source = updated;target.revision = result.revision;
    target.end += updated.length - latest.values[target.field.key].length;
    showPublishStatus(result);
    appendInput.value = '';renderAppendPreview();persistAppendDraft();
    appendMessage('已插入原文并保存到本地，可继续追问或撤销本次插入。');
  } catch (error) { persistAppendDraft();appendMessage(error.message, true); }
  finally { appendState.busy = false;updateAppendControls(); }
}
async function undoAppend() {
  const undo = appendState.undo;
  if (!undo || appendState.busy || editor.active || editor.busy || publishing) return;
  appendState.busy = 'save';updateAppendControls();
  try {
    const result = await localRequest('save', {...undo, includeView: true});
    const target = appendState.target;
    const previous = undo.values[target.field.key];
    target.end -= target.source.length - previous.length;
    target.source = previous;target.revision = result.revision;
    appendState.undo = null;
    applyAppendView(result.view, target.field.key);
    showPublishStatus(result);persistAppendDraft();
    appendMessage('已撤销本次插入，追问和回答仍保留。');
  } catch (error) { appendMessage(error.message, true); }
  finally { appendState.busy = false;updateAppendControls(); }
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
  appendState.answerDrafts = {};
  appendState.partial = '';
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
appendDialog.querySelector('#append-locate').addEventListener('click', locateAppendSource);
appendDialog.querySelector('#append-undo').addEventListener('click', undoAppend);
appendDialog.querySelector('#append-backup').addEventListener('click', () => {
  const conversation = appendState.history.map((message, index) => {
    const label = message.role === 'user' ? '追问：' : '回答：';
    const text = message.role === 'assistant' ? (appendState.answerDrafts[index] ?? message.content) : message.content;
    return label + text;
  }).join('\n\n');
  const content = `位置：${appendDialog.querySelector('#append-location').textContent}\n\n原段落：\n${appendState.target.paragraph}\n\n追问对话：\n${conversation}\n\n未完成的回答（仅作草稿）：\n${appendState.partial}\n\n尚未发送的问题：\n${appendQuestion.value}\n\n补充预览：\n${appendInput.value}`;
  const url = URL.createObjectURL(new Blob([content], {type: 'text/plain;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = '知识点补充草稿.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('beforeunload', event => {
  persistAppendDraft();
  if (appendState.busy === 'save' && !editor.reloading) { event.preventDefault(); event.returnValue = ''; }
});

const appendResize = appendDialog.querySelector('.append-resize');
function setAppendWidth(width) {
  const maximum = Math.min(620, innerWidth * .46);
  const value = Math.min(maximum, Math.max(340, width));
  document.documentElement.style.setProperty('--append-width', value + 'px');
  document.querySelector('.workspace').style.setProperty('--append-width', value + 'px');
  appendResize.setAttribute('aria-valuenow', String(Math.round(value)));
  appendResize.setAttribute('aria-valuemin', '340');
  appendResize.setAttribute('aria-valuemax', String(Math.round(maximum)));
}
appendResize.addEventListener('pointerdown', event => {
  event.preventDefault();appendResize.setPointerCapture(event.pointerId);
  const move = event => setAppendWidth(innerWidth - event.clientX);
  const stop = () => { appendResize.removeEventListener('pointermove', move);appendResize.removeEventListener('pointerup', stop); };
  appendResize.addEventListener('pointermove', move);appendResize.addEventListener('pointerup', stop);
});
appendResize.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();setAppendWidth(appendDialog.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 20 : -20));
});
window.addEventListener('resize', () => {
  if (innerWidth > 760 && appendState.open) setAppendWidth(appendDialog.getBoundingClientRect().width);
});
