let doubaoCategory = 'all';
let doubaoQuery = '';

function filteredDoubaoQuestions() {
  const query = doubaoQuery.trim().toLowerCase();
  return DATA.doubao.questions.filter(question =>
    (doubaoCategory === 'all' || question.category === doubaoCategory) && question.search.toLowerCase().includes(query)
  );
}
function doubaoQuestionCard(question, expanded = false) {
  const number = question.id.split('-').at(-1);
  return `<details class="doubao-question" data-question-id="${question.id}" ${expanded ? 'open' : ''}>
    <summary><span class="doubao-meta">${DATA.doubao.categories[question.category]} · ${number}</span><span class="doubao-title" data-highlight-key="doubao/${question.id}/title">${escapeHTML(question.title)}</span><span class="doubao-toggle" aria-hidden="true">+</span></summary>
    <div class="doubao-answer">
      ${question.framework ? `<section><h3>回答框架</h3><div class="prose" data-highlight-key="doubao/${question.id}/framework">${question.framework}</div></section>` : ''}
      <section><h3>口述参考答案</h3><div class="prose" data-highlight-key="doubao/${question.id}/answer">${question.answer}</div></section>
      ${question.supplement ? `<details class="doubao-supplement"><summary>原文补充 · 金句与案例</summary><div class="prose" data-highlight-key="doubao/${question.id}/supplement">${question.supplement}</div></details>` : ''}
      ${expanded ? '' : `<a class="text-button" href="#${question.id}">单独打开此题 ↗</a>`}
    </div>
  </details>`;
}
function renderDoubaoResults() {
  const questions = filteredDoubaoQuestions();
  document.getElementById('doubao-count').textContent = `${questions.length} / ${DATA.doubao.questions.length} 道题`;
  document.getElementById('doubao-results').innerHTML = questions.map(question => doubaoQuestionCard(question)).join('') || '<div class="empty"><h3>没有找到匹配的题目。</h3><p>试试更短的关键词，或切换题目分类。</p></div>';
  document.querySelectorAll('[data-doubao-category]').forEach(button => {
    const selected = button.dataset.doubaoCategory === doubaoCategory;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}
function doubaoView(selectedId) {
  const selected = DATA.doubao.questions.find(question => question.id === selectedId);
  const counts = Object.fromEntries(Object.keys(DATA.doubao.categories).map(category => [category, DATA.doubao.questions.filter(question => question.category === category).length]));
  main.innerHTML = `${pageHeader('AI 面试', '豆包面试题', '从产品判断到技术原理，分两条线练习表达。题干、回答框架与口述答案按分享内容保留。')}
    ${selected ? `<p><a class="text-button" href="#doubao">← 返回全部豆包面试题</a></p>${doubaoQuestionCard(selected, true)}` : `<div class="doubao-controls"><div class="doubao-categories" role="group" aria-label="面试题分类"><button class="btn small" data-doubao-category="all">全部 ${DATA.doubao.questions.length}</button>${Object.entries(DATA.doubao.categories).map(([id, label]) => `<button class="btn small" data-doubao-category="${id}">${label} ${counts[id]}</button>`).join('')}</div><label class="doubao-search">搜索题目与答案<input id="doubao-search" type="search" placeholder="例如：RAG、长记忆、商业化" value="${escapeHTML(doubaoQuery)}"></label></div><p id="doubao-count" class="content-count" aria-live="polite"></p><div id="doubao-results"></div>`}
    ${footer()}`;
  if (!selected) renderDoubaoResults();
}
document.addEventListener('click', event => {
  const category = event.target.closest('[data-doubao-category]');
  if (!category) return;
  doubaoCategory = category.dataset.doubaoCategory;
  renderDoubaoResults();
});
document.addEventListener('input', event => {
  if (event.target.id !== 'doubao-search') return;
  doubaoQuery = event.target.value;
  renderDoubaoResults();
});
