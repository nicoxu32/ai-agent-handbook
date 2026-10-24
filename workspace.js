const projects = [
  {id: 'agent', name: 'AI 智能体平台', route: 'home', ready: true},
  {id: 'hardware', name: '智能硬件设备', route: 'hardware', ready: false}
];
document.getElementById('project-select').innerHTML = projects.map(project =>
  `<option value="${project.id}">${escapeHTML(project.name)}${project.ready ? '' : ' · 待补充'}</option>`
).join('');
const sectionRoutes = {
  overview: ['home', 'architecture', 'extra1', 'extra2', 'extra4'],
  interview: ['bank', 'practice', 'challenge', 'doubao']
};
const learningRounds = DATA.rounds;
const projectLastRoutes = {agent: 'home', hardware: 'hardware'};
const navigationState = {sections: new Set(['overview']), groups: new Set()};
let architectureTrace = 'all';
let bankScope = 'all';
let bankQuery = '';

function currentProject() {
  return projects.find(project => !project.ready && project.route === activeRoute) || projects[0];
}
function currentSection() {
  if (sectionRoutes.overview.includes(activeRoute)) return 'overview';
  if (sectionRoutes.interview.includes(activeRoute) || activeRoute.startsWith('challenge-') || activeRoute.startsWith('db-')) return 'interview';
  return 'catalog';
}
function chapterByNumber(number) {
  return DATA.chapters.find(chapter => Number(chapter.number) === Number(number));
}
function chapterChips(numbers) {
  return numbers.map(number => {
    const chapter = chapterByNumber(number);
    return `<a href="#${chapter.id}" class="knowledge-chip" title="阅读知识点 ${chapter.number}：${escapeHTML(chapter.short)}">${chapter.number} ${escapeHTML(chapter.short)}</a>`;
  }).join('');
}
function sidebarLink(route, label, selected = activeRoute === route) {
  return `<button class="section-link ${selected ? 'active' : ''}" data-route="${route}" ${selected ? 'aria-current="page"' : ''}>${label}</button>`;
}
function buildSidebar() {
  const project = currentProject();
  const container = document.getElementById('sidebar-nav');
  const scrollTop = container.scrollTop;
  document.getElementById('project-select').value = project.id;
  searchInput.disabled = !project.ready;
  document.querySelector('.topbar-edit').disabled = !project.ready;
  searchInput.placeholder = project.ready ? '搜索当前项目知识与题目…' : '本项目内容待补充';
  if (!project.ready) {
    container.innerHTML = `<div class="project-pending"><span class="badge">待补充</span><p>${escapeHTML(project.name)}的知识点与面试内容将在这里整理。</p></div>`;
    return;
  }
  const section = currentSection();
  navigationState.sections.add(section);
  const chapter = DATA.chapters.find(item => item.id === activeRoute);
  if (chapter) navigationState.groups.add(String(chapter.group));
  const groupLinks = DATA.groups.map((group, index) => `<details class="nav-group" data-group="${index}" ${navigationState.groups.has(String(index)) ? 'open' : ''}><summary><span class="group-index">${String.fromCharCode(65 + index)}</span>${group}</summary>${DATA.chapters.filter(item => item.group === index).map(item => `<button class="nav-topic ${activeRoute === item.id ? 'active' : ''}" data-route="${item.id}" ${activeRoute === item.id ? 'aria-current="page"' : ''}><span class="num">${item.number}</span><span>${escapeHTML(item.short)}</span></button>`).join('')}</details>`).join('');
  container.innerHTML = `<details class="nav-section" data-section="overview" ${navigationState.sections.has('overview') ? 'open' : ''}><summary><span>01</span>学习总览</summary><div class="section-links">${sidebarLink('home', '学习指南与路径')}${sidebarLink('architecture', '知识点任务架构图')}</div></details><details class="nav-section" data-section="catalog" ${navigationState.sections.has('catalog') ? 'open' : ''}><summary><span>02</span>知识目录 <small>36</small></summary><div class="section-links">${sidebarLink('catalog', '全部知识点')}</div>${groupLinks}</details><details class="nav-section" data-section="interview" ${navigationState.sections.has('interview') ? 'open' : ''}><summary><span>03</span>AI 面试</summary><div class="section-links">${sidebarLink('bank', '核心面试题库 · 108 题', ['bank','practice'].includes(activeRoute))}${sidebarLink('doubao', '豆包面试题 · ' + DATA.doubao.questions.length + ' 题', activeRoute === 'doubao' || activeRoute.startsWith('db-'))}${sidebarLink('challenge', 'AI 实时出题', activeRoute.startsWith('challenge'))}</div></details>`;
  container.scrollTop = scrollTop;
}
function pageHeader(section, title, description) {
  const copy = !searchInput.value.trim() && DATA.pages[activeRoute];
  if (copy) {
    title = escapeHTML(copy.title);
    description = escapeHTML(copy.description);
  }
  return `<header class="workspace-page-head"><h1 class="page-title">${title}</h1><p class="hero-copy">${description}</p></header>`;
}
function home() {
  const last = DATA.chapters.find(chapter => chapter.id === state.last);
  main.innerHTML = `${pageHeader('学习总览', '先理解，再讲清。', '按三轮学习路径，把 36 个知识点串成完整方案；结合任务架构图理解各环节，再进入面试练习。')}<div class="overview-actions actions"><button class="btn primary" data-route="${state.last}">继续阅读 ${last.number} · ${escapeHTML(last.short)} ${icon('arrow')}</button><button class="btn" data-route="catalog">查看 36 个知识点</button></div><div class="overview-links"><a href="#architecture"><span>看见全貌</span><strong>知识点任务架构图 →</strong><small>把概念放回任务中的位置</small></a><a href="#bank"><span>练习表达</span><strong>进入 AI 面试 →</strong><small>108 道核心题 + AI 实时出题</small></a></div><section id="learning-path" class="reading-section"><div class="section-head"><h2>按三轮路径，逐步建立理解</h2></div><div class="priority-guide"><span><b>P0</b> 能独立讲清基础</span><span><b>P1</b> 能结合场景判断</span><span><b>P2</b> 知道何时值得采用</span></div><p class="content-count">优先级代表学习顺序，不代表它在产品中是否重要。</p>${learningRounds.map((round, index) => `<section class="path-card"><div class="path-head"><span class="path-index">0${index + 1}</span><div><h3>${escapeHTML(round.title)}</h3><p>${round.ids.length} 个知识点</p></div></div><p>${escapeHTML(round.description)}</p><div class="path-topics">${round.ids.map(number => { const chapter = chapterByNumber(number); return `<button data-route="${chapter.id}">${chapter.number} ${escapeHTML(chapter.short)}</button>`; }).join('')}</div></section>`).join('')}</section>${footer()}`;
}
function catalogView() {
  const selected = DATA.chapters;
  const sections = DATA.groups.map((group, index) => {
    const chapters = selected.filter(chapter => chapter.group === index);
    if (!chapters.length) return '';
    return `<section class="catalog-module"><header><span class="module-index">模块 0${index + 1}</span><h2>${group}</h2><p>${groupCopy[index]}</p></header><div class="catalog-rows">${chapters.map(chapter => `<article class="catalog-row"><a href="#${chapter.id}"><span class="catalog-number">${chapter.number}</span><div><h3>${escapeHTML(chapter.short)}</h3><p>${escapeHTML(chapter.title.split('：').slice(1).join('：'))}</p></div><span class="badge">${chapter.priority}</span></a></article>`).join('')}</div></section>`;
  }).join('');
  main.innerHTML = `${pageHeader('知识目录', '36 个知识点，逐个讲明白。', '六个模块串起模型、知识、执行、集成、平台和产品。每个知识点都关联三道核心面试题，也可以继续让 AI 出新题。')}${sections}${footer()}`;
}
function filteredBank() {
  const query = bankQuery.trim().toLowerCase();
  return allQuestions.filter(question => {
    const inScope = bankScope === 'all' || question.chapter.id === bankScope || String(question.chapter.group) === bankScope;
    return inScope && (!query || withChineseTerms(`${question.title} ${question.chapter.title} ${plain(question.answer)}`).toLowerCase().includes(query));
  });
}
function renderBankResults() {
  const questions = filteredBank();
  document.getElementById('bank-count').textContent = `${questions.length} / 108 道题`;
  document.getElementById('bank-results').innerHTML = questions.map(question => `<article class="bank-question"><div class="bank-chapter"><a class="knowledge-chip" href="#${question.chapter.id}" aria-label="阅读知识讲解：${escapeHTML(question.chapter.short)}">${escapeHTML(question.chapter.short)}</a></div><h2 data-highlight-key="question/${question.id}/title">${escapeHTML(question.title)}</h2><div class="actions"><button class="btn small" data-action="practice-question" data-id="${question.id}">口述练习 · 查看答案 →</button></div></article>`).join('') || '<div class="empty"><h3>没有找到匹配的题目。</h3><p>试着缩短关键词或切换知识范围。</p></div>';
}
function bankView() {
  main.innerHTML = `${pageHeader('AI 面试', '核心面试题库', '围绕 36 个知识点练习原理、方案与排查，共 108 道题。可以按知识点找题，也可以回看对应讲解。')}<div class="bank-controls"><label>知识范围<select id="bank-scope" class="select"><option value="all">全部 108 道题</option><optgroup label="按模块">${DATA.groups.map((group, index) => `<option value="${index}">${group}</option>`).join('')}</optgroup><optgroup label="按知识点">${DATA.chapters.map(chapter => `<option value="${chapter.id}">${chapter.number} · ${escapeHTML(chapter.short)}</option>`).join('')}</optgroup></select></label><label>搜索题目与答案<input id="bank-search" type="search" placeholder="例如：权限、重试、RAG" value="${escapeHTML(bankQuery)}"></label></div><p id="bank-count" class="content-count" aria-live="polite"></p><div id="bank-results"></div>${footer()}`;
  document.getElementById('bank-scope').value = bankScope;
  renderBankResults();
}
function architectureNode(id) {
  const node = DATA.architecture.nodes.find(item => item.id === id);
  return `<article class="arch-node" id="arch-${node.id}" data-traces="${node.traces.join(' ')}"><h3>${escapeHTML(node.title)}</h3><p>${escapeHTML(node.description)}</p><dl><div><dt>输入</dt><dd>${escapeHTML(node.input)}</dd></div><div><dt>产出</dt><dd>${escapeHTML(node.output)}</dd></div></dl><div class="knowledge-chips">${chapterChips(node.chapters)}</div></article>`;
}
function architectureArrow(label) {
  return `<div class="arch-arrow"><span aria-hidden="true">↓</span><small>${label}</small></div>`;
}
function applyArchitectureTrace() {
  const trace = DATA.architecture.traces[architectureTrace];
  document.getElementById('trace-description').textContent = trace.description;
  document.querySelectorAll('[data-trace-choice]').forEach(button => {
    const selected = button.dataset.traceChoice === architectureTrace;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('.arch-node').forEach(node => {
    const secondary = architectureTrace !== 'all' && !node.dataset.traces.split(' ').includes(architectureTrace);
    node.classList.toggle('secondary-node', secondary);
  });
}
function architectureView() {
  main.innerHTML = `${pageHeader('学习总览', '把 36 个知识点，连成一张任务图。', '这是一种通用的学习架构，用来解释知识点之间的关系，不代表任何具体平台的实际部署。点击编号可阅读对应知识点。')}<div class="trace-controls" role="group" aria-label="选择任务路径">${Object.entries(DATA.architecture.traces).map(([id, trace]) => `<button class="btn small" data-trace-choice="${id}">${escapeHTML(trace.title)}</button>`).join('')}</div><p class="trace-description" id="trace-description" aria-live="polite"></p><div class="architecture-map"><div class="arch-main"><div class="arch-layer-label">主任务链路 · 从目标到真实结果</div>${architectureNode('goal')}${architectureArrow('先确认边界')}${architectureNode('scope')}<div class="arch-loop">条件缺失 / 无权限 → 补充信息或明确停止，不能直接进入执行。</div>${architectureArrow('携带有效状态进入调度')}${architectureNode('plan')}${architectureArrow('按需调用以下能力，可组合使用')}<div class="arch-branches">${architectureNode('knowledge')}${architectureNode('multimodal')}${architectureNode('memory')}</div>${architectureArrow('证据、内容和任务状态进入模型')}${architectureNode('model')}${architectureArrow('生成的建议不等于真实执行结果')}${architectureNode('check')}<div class="arch-loop">未确认 / 校验失败 → <a href="#arch-scope" data-jump="arch-scope">补充或修改范围 ↑</a>；结果证据不足 → <a href="#arch-plan" data-jump="arch-plan">重新选择动作 ↑</a></div>${architectureArrow('需要操作时：授权通过后执行；纯问答可直接核验并交付')}${architectureNode('tools')}${architectureArrow('返回回执，或进入异步查询')}${architectureNode('receipt')}<div class="arch-loop">未完成 → <a href="#arch-plan" data-jump="arch-plan">带状态返回调度 ↑</a>；失败 → 恢复 / 补偿 / 人工介入；状态未知 → 先查询，避免重复执行。</div>${architectureArrow('目标已达成，或已到明确停止条件')}${architectureNode('delivery')}</div><aside class="arch-rail" aria-label="贯穿任务的共享能力"><div class="arch-layer-label">共享能力 · 贯穿各环节</div><p class="arch-rail-note">模型服务支撑每次调用；权限校验覆盖检索和工具；日志、评测和成本记录贯穿整条链路。</p>${architectureNode('routing')}${architectureNode('security')}${architectureNode('operations')}${architectureNode('value')}<div class="arch-loop">反馈与评测 → 形成优化优先级 → 版本验证 → <a href="#arch-goal" data-jump="arch-goal">下一轮任务与产品改进 ↑</a></div></aside></div><div class="bottom-band"><div><h3>用一个完整案例，把图讲出来。</h3><p>先说明输入，再走一遍判断、执行和核验。</p></div><button class="btn" data-route="extra1">阅读完整案例 →</button></div>${footer()}`;
  applyArchitectureTrace();
}
function pendingProjectView() {
  const project = currentProject();
  main.innerHTML = `<div class="pending-page"><div class="eyebrow">项目学习手册</div><span class="badge">内容待补充</span><h1 class="page-title">${escapeHTML(project.name)}</h1><p class="hero-copy">这个项目已经有自己的入口。后续知识点、学习路径和面试内容，会在这里逐步整理。</p><div class="pending-sections"><span>01 学习总览</span><span>02 知识目录</span><span>03 AI 面试</span></div><button class="btn" data-route="home">先学习 AI 智能体平台 →</button></div>`;
}
function setPagePath(items) {
  document.getElementById('page-path').innerHTML = items.map((item, index) => {
    const last = index === items.length - 1;
    const label = escapeHTML(item.label);
    return `${index ? '<span aria-hidden="true">/</span>' : ''}${last ? `<strong id="page-name" aria-current="page">${label}</strong>` : `<button data-route="${item.route}">${label}</button>`}`;
  }).join('');
}
function updatePageHeading() {
  const project = currentProject();
  const chapter = DATA.chapters.find(item => item.id === activeRoute);
  const extra = DATA.extras.find(item => item.id === activeRoute);
  const names = {home: '学习指南与路径', catalog: '知识目录', architecture: '知识点任务架构图', bank: '核心面试题库', doubao: '豆包面试题'};
  const sections = {overview: {label: '学习总览', route: 'home'}, catalog: {label: '知识目录', route: 'catalog'}, interview: {label: 'AI 面试', route: 'bank'}};
  const items = [{label: project.name, route: project.route}];
  let name = names[activeRoute] || extra?.title || project.name;
  if (!project.ready) items.push({label: '内容待补充'});
  else {
    const section = sections[currentSection()];
    if (name !== section.label || chapter) items.push(section);
    if (chapter) {
      items.push({label: DATA.groups[chapter.group], route: 'catalog'});
      name = chapter.short;
    } else if (activeRoute === 'practice') {
      items.push({label: '核心面试题库', route: 'bank'});
      name = practiceQuestions()[state.practiceIndex].chapter.short;
    } else if (activeRoute.startsWith('db-')) {
      const question = DATA.doubao.questions.find(item => item.id === activeRoute);
      items.push({label: '豆包面试题', route: 'doubao'});
      name = DATA.doubao.categories[question.category] + ' · ' + question.id.split('-').at(-1);
    } else if (activeRoute.startsWith('challenge')) {
      items.push({label: 'AI 出题', route: 'challenge'});
      name = challengeChapter().short;
    }
    items.push({label: name});
  }
  setPagePath(items);
  document.title = `${name} · ${project.name} · AI 知识点手册`;
}
function renderRoute() {
  if (editor.active && !leaveEditorForNavigation()) return;
  const requested = location.hash.slice(1) || 'home';
  const aliases = {interview: 'bank', path: 'home', guide: 'home', extra0: 'architecture', extra3: 'catalog', glossary: 'catalog'};
  let route = aliases[requested] || requested;
  const routes = ['home','catalog','architecture','bank','practice','challenge','doubao',...DATA.doubao.questions.map(question => question.id),...projects.filter(project => !project.ready).map(project => project.route),...DATA.chapters.map(chapter => chapter.id),...DATA.chapters.map(chapter => 'challenge-' + chapter.id),...DATA.extras.map(extra => extra.id)];
  if (!routes.includes(route)) route = 'home';
  if (route !== requested) history.replaceState(null, '', '#' + route);
  if (activeRoute !== route) answerVisible = false;
  activeRoute = route;
  projectLastRoutes[currentProject().id] = route;
  searchInput.value = '';
  setMenu(false);
  const chapter = DATA.chapters.find(item => item.id === route);
  const views = {home, catalog: catalogView, architecture: architectureView, bank: bankView, practice, doubao: doubaoView};
  if (!currentProject().ready) pendingProjectView();
  else if (chapter) lesson(chapter);
  else if (views[route]) views[route]();
  else if (route.startsWith('db-')) doubaoView(route);
  else if (route.startsWith('challenge')) challengeView();
  else extraView(DATA.extras.find(item => item.id === route));
  buildSidebar();
  updatePageHeading();
  main.classList.remove('view-enter');
  void main.offsetWidth;
  main.classList.add('view-enter');
  main.focus({preventScroll: true});
  window.scrollTo({top: 0, behavior: 'instant'});
  if (requested === 'path') document.getElementById('learning-path').scrollIntoView();
}
function searchView(query) {
  if (!currentProject().ready) return;
  setPagePath([{label: 'AI 智能体平台', route: 'home'}, {label: '搜索结果'}]);
  const normalized = query.toLowerCase();
  const chapters = DATA.chapters.filter(chapter => chapter.search.toLowerCase().includes(normalized));
  const doubaoMatches = DATA.doubao.questions.filter(question => question.search.toLowerCase().includes(normalized));
  const supplements = [
    {id: 'home', title: '学习指南与路径', content: learningRounds.map(round => round.title + round.description).join(' ')},
    {id: 'architecture', title: '知识点任务架构图', content: DATA.architecture.nodes.map(node => node.title + node.description + node.input + node.output).join(' ')},
    ...DATA.extras.filter(extra => ['extra1','extra2','extra4'].includes(extra.id)).map(extra => ({id: extra.id, title: extra.title, content: plain(extra.html)}))
  ].filter(item => withChineseTerms(item.title + item.content).toLowerCase().includes(normalized));
  main.innerHTML = `<div class="reader">${pageHeader('项目内搜索', '找到需要的知识。', `“${escapeHTML(query)}” · ${chapters.length} 个知识点，${supplements.length} 篇学习资料，${doubaoMatches.length} 道豆包面试题`)}${chapters.map(chapter => resultCard(chapter, query)).join('')}${supplements.map(item => `<button class="result" data-route="${item.id}"><span class="result-top">学习总览</span><h3>${escapeHTML(item.title)}</h3><p>查看完整内容 →</p></button>`).join('')}${doubaoMatches.map(question => `<button class="result" data-route="${question.id}"><span class="result-top">豆包面试题 · ${DATA.doubao.categories[question.category]}</span><h3>${escapeHTML(question.title)}</h3><p>查看回答框架与口述答案 →</p></button>`).join('')}${!chapters.length && !supplements.length && !doubaoMatches.length ? '<div class="empty"><h3>没有找到匹配内容。</h3><p>试试更短的关键词。</p></div>' : ''}${footer()}</div>`;
}

document.getElementById('project-select').addEventListener('change', event => {
  const project = projects.find(item => item.id === event.target.value);
  go(projectLastRoutes[project.id] || project.route);
});
document.getElementById('sidebar-nav').addEventListener('toggle', event => {
  if (event.target.matches('.nav-section')) {
    const id = event.target.dataset.section;
    if (event.target.open) navigationState.sections.add(id);
    else navigationState.sections.delete(id);
  }
  if (event.target.matches('.nav-group')) {
    const id = event.target.dataset.group;
    if (event.target.open) navigationState.groups.add(id);
    else navigationState.groups.delete(id);
  }
}, true);
document.addEventListener('click', event => {
  const trace = event.target.closest('[data-trace-choice]');
  if (trace) {
    architectureTrace = trace.dataset.traceChoice;
    applyArchitectureTrace();
  }
  const action = event.target.closest('[data-action]');
  if (action?.dataset.action === 'bank-topic') {
    bankScope = action.dataset.id;
    bankQuery = '';
    go('bank');
  }
  if (action?.dataset.action === 'practice-question') {
    const question = allQuestions.find(item => item.id === action.dataset.id);
    state.practiceGroup = question.chapter.id;
    state.practiceIndex = question.chapter.questions.findIndex(item => item.id === question.id);
    go('practice');
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'bank-search') {
    bankQuery = event.target.value;
    renderBankResults();
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'bank-scope') {
    bankScope = event.target.value;
    renderBankResults();
  }
});
