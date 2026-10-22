const projects = [
  {id: 'agent', name: 'AI 智能体平台', route: 'home', ready: true},
  {id: 'hardware', name: '智能硬件设备', route: 'hardware', ready: false}
];
document.getElementById('project-select').innerHTML = projects.map(project =>
  `<option value="${project.id}">${escapeHTML(project.name)}${project.ready ? '' : ' · 待补充'}</option>`
).join('');
const sectionRoutes = {
  overview: ['home', 'architecture', 'glossary', 'extra1', 'extra2', 'extra4'],
  interview: ['interview', 'bank', 'practice', 'challenge']
};
const learningRounds = [
  {title: '先讲通一个完整任务', description: '建立基础概念，解释从查资料、生成报告到确认保存的完整过程。', ids: [1,2,3,4,5,11,14,15,16,17,18,27,29,31,33]},
  {title: '再解释为什么会失败', description: '沿着任务链路，区分资料、检索、模型、工具和交互的问题。', ids: [6,7,8,9,10,12,13,21,22,23,26,28,30,34,35,36]},
  {title: '最后讨论方案取舍', description: '判断复杂方案何时值得采用，比较质量、时延与成本。', ids: [19,20,24,25,32]}
];
const projectLastRoutes = {agent: 'home', hardware: 'hardware'};
const navigationState = {sections: new Set(['overview']), groups: new Set()};
let architectureTrace = 'all';
let bankScope = 'all';
let bankQuery = '';
const glossaryExamples = [
  '给模型一份会议记录，让它整理结论；这次提供记录不等于重新训练模型。',
  '长报告加上历史对话可能超出一次调用的容量，需要选取相关内容并为回答留空间。',
  '约定订单结果必须包含 orderId、status 和 amount，字段合规后还要核验业务状态。',
  '扫描合同先识别文字；会议录音先转成文本，再提取条款或待办。',
  '把制度拆成片段，再用向量寻找与“出差住酒店能报多少”相关的段落。',
  '资料非常多时先近似找一批邻近向量；速度快了，也要检查是否漏掉正确资料。',
  '型号、订单号适合关键词精确匹配；不同检索结果可以按名次融合后再筛选。',
  '先从候选资料里挑出更相关的证据，再用证据回答，并附上能支撑结论的引用。',
  '同名制度保留生效时间与版本，回答今年报销规则时避免引用旧制度。',
  '固定审批链走流程；要根据检索或工具结果决定下一步时，才需要动态选择行动。',
  '通过统一协议发现和调用文件查询能力，但仍需单独做账号授权与权限检查。',
  '“本次出差改到周五”是有效任务状态；“用户偏好简短回答”可能进入可修改的长期记忆。',
  '用户授权读取日历，不代表也授权删除日程；每项操作都要落到允许的范围。',
  '创建订单请求超时后，用同一业务幂等标识重试，避免多创建一张订单。',
  'Trace 帮你找到慢在哪一步；P95 耗时说明大多数任务的等待上界，不是平均耗时。',
  '用同一批任务比较新旧提示词的正确率、成本和失败情况，再决定是否上线。',
  '先让一类资料完成“检索—生成—确认保存”的闭环，再考虑更多复杂任务。'
];

function currentProject() {
  return projects.find(project => !project.ready && project.route === activeRoute) || projects[0];
}
function currentSection() {
  if (sectionRoutes.overview.includes(activeRoute)) return 'overview';
  if (sectionRoutes.interview.includes(activeRoute) || activeRoute.startsWith('challenge-')) return 'interview';
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
  document.querySelector('.sidebar-footer').hidden = !project.ready;
  searchInput.disabled = !project.ready;
  searchInput.placeholder = project.ready ? '搜索当前项目知识与题目…' : '本项目内容待补充';
  if (!project.ready) {
    container.innerHTML = `<div class="project-pending"><span class="badge">待补充</span><p>${escapeHTML(project.name)}的知识点与面试内容将在这里整理。</p></div>`;
    return;
  }
  const section = currentSection();
  navigationState.sections.add(section);
  const chapter = DATA.chapters.find(item => item.id === activeRoute);
  if (chapter) navigationState.groups.add(String(chapter.group));
  const groupLinks = DATA.groups.map((group, index) => `<details class="nav-group" data-group="${index}" ${navigationState.groups.has(String(index)) ? 'open' : ''}><summary><span class="group-index">${String.fromCharCode(65 + index)}</span>${group}</summary>${DATA.chapters.filter(item => item.group === index).map(item => `<button class="nav-topic ${activeRoute === item.id ? 'active' : ''}" data-route="${item.id}" ${activeRoute === item.id ? 'aria-current="page"' : ''}><span class="num">${item.number}</span><span>${escapeHTML(item.short)}</span>${state.done.has(item.id) ? '<span class="done" aria-label="已学">✓</span>' : ''}</button>`).join('')}</details>`).join('');
  container.innerHTML = `<details class="nav-section" data-section="overview" ${navigationState.sections.has('overview') ? 'open' : ''}><summary><span>01</span>学习总览</summary><div class="section-links">${sidebarLink('home', '学习指南与路径')}${sidebarLink('architecture', '知识点任务架构图')}${sidebarLink('glossary', '常用术语说明')}</div></details><details class="nav-section" data-section="catalog" ${navigationState.sections.has('catalog') ? 'open' : ''}><summary><span>02</span>知识目录 <small>36</small></summary><div class="section-links">${sidebarLink('catalog', '全部知识点 · 收藏与进度')}</div>${groupLinks}</details><details class="nav-section" data-section="interview" ${navigationState.sections.has('interview') ? 'open' : ''}><summary><span>03</span>AI 面试</summary><div class="section-links">${sidebarLink('interview', '面试练习总览')}${sidebarLink('bank', '核心面试题库 · 108 题', ['bank','practice'].includes(activeRoute))}${sidebarLink('challenge', 'AI 实时出题', activeRoute.startsWith('challenge'))}</div></details>`;
  container.scrollTop = scrollTop;
  updateProgress();
}
function pageHeader(section, title, description) {
  return `<header class="workspace-page-head"><div class="eyebrow">AI 智能体平台 / ${section}</div><h1 class="page-title">${title}</h1><p class="hero-copy">${description}</p></header>`;
}
function home() {
  const last = DATA.chapters.find(chapter => chapter.id === state.last);
  main.innerHTML = `${pageHeader('学习总览', '先理解，再讲清。', '阅读方法、学习顺序和任务全貌，都从这里开始。按自己的节奏，把 36 个知识点串成一个完整方案。')}<div class="overview-actions actions"><button class="btn primary" data-route="${state.last}">继续阅读 ${last.number} · ${escapeHTML(last.short)} ${icon('arrow')}</button><button class="btn" data-route="catalog">查看 36 个知识点</button></div><div class="overview-links"><a href="#architecture"><span>看见全貌</span><strong>知识点任务架构图 →</strong><small>把概念放回任务中的位置</small></a><a href="#glossary"><span>随时查阅</span><strong>常用术语说明 →</strong><small>口语解释、场景例子与回看</small></a><a href="#interview"><span>练习表达</span><strong>进入 AI 面试 →</strong><small>108 道核心题 + AI 实时出题</small></a></div><section class="guide-section"><div class="section-head"><h2>这份手册怎么学</h2><span class="badge">理解 → 判断 → 表达</span></div><div class="prose guide-copy">${DATA.guide.replace('<h2>先说这份手册怎么用</h2>', '')}</div></section><section id="learning-path" class="reading-section"><div class="section-head"><h2>按三轮路径，逐步建立理解</h2><span class="content-count">已学 ${state.done.size} / 36</span></div><div class="priority-guide"><span><b>P0</b> 能独立讲清基础</span><span><b>P1</b> 能结合场景判断</span><span><b>P2</b> 知道何时值得采用</span></div><p class="content-count">优先级代表学习顺序，不代表它在产品中是否重要。</p>${learningRounds.map((round, index) => `<section class="path-card"><div class="path-head"><span class="path-index">0${index + 1}</span><div><h3>${round.title}</h3><p>${round.ids.filter(number => state.done.has(chapterByNumber(number).id)).length} / ${round.ids.length} 个知识点已学</p></div></div><p>${round.description}</p><div class="path-topics">${round.ids.map(number => { const chapter = chapterByNumber(number); return `<button data-route="${chapter.id}">${state.done.has(chapter.id) ? '✓ ' : ''}${chapter.number} ${escapeHTML(chapter.short)}</button>`; }).join('')}</div></section>`).join('')}</section><section><div class="section-head"><h2>把理解讲成方案</h2></div><div class="overview-links compact"><a href="#extra1"><strong>完整案例口述 →</strong><small>出差复盘与批量删除</small></a><a href="#extra2"><strong>口述练习方法 →</strong><small>概念、方案、排查与经历题</small></a><a href="#extra4"><strong>来源与使用范围 →</strong><small>产品参照和学习内容的边界</small></a></div></section>${footer()}`;
}
function catalogView() {
  const selected = DATA.chapters.filter(chapter => state.filter === 'all' || (state.filter === 'unfinished' && !state.done.has(chapter.id)) || (state.filter === 'bookmarks' && state.bookmarks.has(chapter.id)));
  const sections = DATA.groups.map((group, index) => {
    const chapters = selected.filter(chapter => chapter.group === index);
    if (!chapters.length) return '';
    return `<section class="catalog-module"><header><span class="module-index">MODULE 0${index + 1}</span><h2>${group}</h2><p>${groupCopy[index]}</p></header><div class="catalog-rows">${chapters.map(chapter => `<article class="catalog-row"><a href="#${chapter.id}"><span class="catalog-number">${chapter.number}</span><div><h3>${escapeHTML(chapter.short)}</h3><p>${escapeHTML(chapter.title.split('：').slice(1).join('：'))}</p></div><span class="badge">${chapter.priority}${state.done.has(chapter.id) ? ' · 已学' : ''}</span></a><div class="catalog-row-actions"><button class="text-button" data-action="bank-topic" data-id="${chapter.id}">关联 3 道面试题</button><a href="#challenge-${chapter.id}">AI 出新题 ↗</a>${state.bookmarks.has(chapter.id) ? '<span class="saved-label">已收藏</span>' : ''}</div></article>`).join('')}</div></section>`;
  }).join('');
  main.innerHTML = `${pageHeader('知识目录', '36 个知识点，逐个讲明白。', '六个模块串起模型、知识、执行、集成、平台和产品。每个知识点都关联三道核心面试题，也可以继续让 AI 出新题。')}<div class="section-head"><p>${selected.length} 个知识点 · 已学 ${state.done.size} / 36</p>${filters()}</div>${sections || '<div class="empty"><h3>这里暂时没有知识点。</h3><p>可以切换到全部，或在阅读时收藏值得回看的内容。</p><button class="btn" data-filter="all">查看全部</button></div>'}${footer()}`;
}
function interviewView() {
  main.innerHTML = `${pageHeader('AI 面试', '把理解，变成自己的回答。', '从核心题掌握判断顺序，再用新的情境检验理解。答案以口述为主，练习时结合自己的真实经历。')}<div class="interview-options"><article><span class="eyebrow">CORE QUESTIONS</span><h2>108 道核心面试题</h2><p>36 个知识点，每节三道。按模块、知识点和关键词查找，再进入口述练习。</p><button class="btn primary" data-route="bank">浏览核心题库 ${icon('arrow')}</button></article><article><span class="eyebrow">NEW SCENARIOS</span><h2>AI 实时出题</h2><p>选择知识点与出题方向，获取新场景、口述参考答案和深入追问。</p><button class="btn primary" data-route="challenge">让 AI 出一道题 ${icon('arrow')}</button></article></div><div class="bottom-band"><div><h3>先说一遍，再看答案。</h3><p>按「核心判断 → 具体场景 → 边界与验证」组织回答。</p></div><button class="btn" data-route="extra2">查看口述方法 →</button></div>${footer()}`;
}
function filteredBank() {
  const query = bankQuery.trim().toLowerCase();
  return allQuestions.filter(question => {
    const inScope = bankScope === 'all' || question.chapter.id === bankScope || String(question.chapter.group) === bankScope;
    return inScope && (!query || `${question.title} ${question.chapter.title} ${plain(question.answer)}`.toLowerCase().includes(query));
  });
}
function renderBankResults() {
  const questions = filteredBank();
  document.getElementById('bank-count').textContent = `${questions.length} / 108 道题`;
  document.getElementById('bank-results').innerHTML = questions.map(question => `<article class="bank-question"><div class="result-top"><span>${question.id}</span><a href="#${question.chapter.id}">${escapeHTML(question.chapter.short)} ↗</a><span class="badge">${question.chapter.priority}</span></div><h2>${escapeHTML(question.title)}</h2><div class="actions"><button class="btn small" data-action="practice-question" data-id="${question.id}">口述练习 · 查看答案 →</button><a class="text-button" href="#${question.chapter.id}">回到知识讲解</a></div></article>`).join('') || '<div class="empty"><h3>没有找到匹配的题目。</h3><p>试着缩短关键词或切换知识范围。</p></div>';
}
function bankView() {
  main.innerHTML = `${pageHeader('AI 面试', '核心面试题库', '原有 108 道题完整保留。可以按知识点找题，也可以从题目回到知识讲解。')}<div class="bank-controls"><label>知识范围<select id="bank-scope" class="select"><option value="all">全部 108 道题</option><optgroup label="按模块">${DATA.groups.map((group, index) => `<option value="${index}">${group}</option>`).join('')}</optgroup><optgroup label="按知识点">${DATA.chapters.map(chapter => `<option value="${chapter.id}">${chapter.number} · ${escapeHTML(chapter.short)}</option>`).join('')}</optgroup></select></label><label>搜索题目与答案<input id="bank-search" type="search" placeholder="例如：权限、重试、RAG" value="${escapeHTML(bankQuery)}"></label></div><p id="bank-count" class="content-count" aria-live="polite"></p><div id="bank-results"></div>${footer()}`;
  document.getElementById('bank-scope').value = bankScope;
  renderBankResults();
}
function glossaryView() {
  main.innerHTML = `${pageHeader('学习总览', '常用术语，放进场景理解。', '先记住它解决什么问题，再回到对应知识点展开学习。')}<div class="glossary-grid">${DATA.glossary.map((item, index) => `<article class="glossary-card"><h2>${escapeHTML(item.term)}</h2><p>${escapeHTML(item.explanation)}</p><div class="glossary-example"><span>放到场景里</span>${escapeHTML(glossaryExamples[index])}</div><div class="knowledge-chips">${chapterChips(item.chapters)}</div></article>`).join('')}</div>${footer()}`;
}
function architectureNode(id) {
  const node = DATA.architecture.nodes.find(item => item.id === id);
  return `<article class="arch-node" id="arch-${node.id}" data-traces="${node.traces.join(' ')}"><h3>${node.title}</h3><p>${node.description}</p><dl><div><dt>输入</dt><dd>${node.input}</dd></div><div><dt>产出</dt><dd>${node.output}</dd></div></dl><div class="knowledge-chips">${chapterChips(node.chapters)}</div></article>`;
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
  main.innerHTML = `${pageHeader('学习总览', '把 36 个知识点，连成一张任务图。', '这是一种通用的学习架构，用来解释知识点之间的关系，不代表任何具体平台的实际部署。点击编号可阅读对应知识点。')}<div class="trace-controls" role="group" aria-label="选择任务路径">${Object.entries(DATA.architecture.traces).map(([id, trace]) => `<button class="btn small" data-trace-choice="${id}">${trace.title}</button>`).join('')}</div><p class="trace-description" id="trace-description" aria-live="polite"></p><div class="architecture-map"><div class="arch-main"><div class="arch-layer-label">主任务链路 · 从目标到真实结果</div>${architectureNode('goal')}${architectureArrow('先确认边界')}${architectureNode('scope')}<div class="arch-loop">条件缺失 / 无权限 → 补充信息或明确停止，不能直接进入执行。</div>${architectureArrow('携带有效状态进入调度')}${architectureNode('plan')}${architectureArrow('按需调用以下能力，可组合使用')}<div class="arch-branches">${architectureNode('knowledge')}${architectureNode('multimodal')}${architectureNode('memory')}</div>${architectureArrow('证据、内容和任务状态进入模型')}${architectureNode('model')}${architectureArrow('生成的建议不等于真实执行结果')}${architectureNode('check')}<div class="arch-loop">未确认 / 校验失败 → <a href="#arch-scope" data-jump="arch-scope">补充或修改范围 ↑</a>；结果证据不足 → <a href="#arch-plan" data-jump="arch-plan">重新选择动作 ↑</a></div>${architectureArrow('需要操作时：授权通过后执行；纯问答可直接核验并交付')}${architectureNode('tools')}${architectureArrow('返回回执，或进入异步查询')}${architectureNode('receipt')}<div class="arch-loop">未完成 → <a href="#arch-plan" data-jump="arch-plan">带状态返回调度 ↑</a>；失败 → 恢复 / 补偿 / 人工介入；状态未知 → 先查询，避免重复执行。</div>${architectureArrow('目标已达成，或已到明确停止条件')}${architectureNode('delivery')}</div><aside class="arch-rail" aria-label="贯穿任务的共享能力"><div class="arch-layer-label">共享能力 · 贯穿各环节</div><p class="arch-rail-note">模型服务支撑每次调用；权限校验覆盖检索和工具；日志、评测和成本记录贯穿整条链路。</p>${architectureNode('routing')}${architectureNode('security')}${architectureNode('operations')}${architectureNode('value')}<div class="arch-loop">反馈与评测 → 形成优化优先级 → 版本验证 → <a href="#arch-goal" data-jump="arch-goal">下一轮任务与产品改进 ↑</a></div></aside></div><div class="bottom-band"><div><h3>用一个完整案例，把图讲出来。</h3><p>先说明输入，再走一遍判断、执行和核验。</p></div><button class="btn" data-route="extra1">阅读完整案例 →</button></div>${footer()}`;
  applyArchitectureTrace();
}
function pendingProjectView() {
  const project = currentProject();
  main.innerHTML = `<div class="pending-page"><div class="eyebrow">PROJECT NOTEBOOK</div><span class="badge">内容待补充</span><h1 class="page-title">${escapeHTML(project.name)}</h1><p class="hero-copy">这个项目已经有自己的入口。后续知识点、学习路径和面试内容，会在这里逐步整理。</p><div class="pending-sections"><span>01 学习总览</span><span>02 知识目录</span><span>03 AI 面试</span></div><button class="btn" data-route="home">先学习 AI 智能体平台 →</button></div>`;
}
function updatePageHeading() {
  const project = currentProject();
  const chapter = DATA.chapters.find(item => item.id === activeRoute);
  const extra = DATA.extras.find(item => item.id === activeRoute);
  const names = {home: '学习指南与路径', catalog: '知识目录', architecture: '知识点任务架构图', glossary: '常用术语说明', interview: 'AI 面试', bank: '核心面试题库 · 108 题'};
  const sections = {overview: '学习总览', catalog: '知识目录', interview: 'AI 面试'};
  let name = names[activeRoute] || extra?.title || project.name;
  let context = `${project.name} / ${sections[currentSection()]}`;
  if (!project.ready) context = '项目 / 内容待补充';
  else if (chapter) name = chapter.short;
  else if (activeRoute === 'practice') name = practiceQuestions()[state.practiceIndex].chapter.short;
  else if (activeRoute.startsWith('challenge')) name = challengeChapter().short;
  document.getElementById('page-name').textContent = name;
  document.getElementById('page-context').textContent = context;
  document.title = `${name} · ${project.name}`;
}
function renderRoute() {
  const requested = location.hash.slice(1) || 'home';
  const aliases = {path: 'home', guide: 'home', extra0: 'architecture', extra3: 'glossary'};
  let route = aliases[requested] || requested;
  const routes = ['home','catalog','architecture','glossary','interview','bank','practice','challenge',...projects.filter(project => !project.ready).map(project => project.route),...DATA.chapters.map(chapter => chapter.id),...DATA.chapters.map(chapter => 'challenge-' + chapter.id),...DATA.extras.map(extra => extra.id)];
  if (!routes.includes(route)) route = 'home';
  if (route !== requested) history.replaceState(null, '', '#' + route);
  if (activeRoute !== route) answerVisible = false;
  activeRoute = route;
  projectLastRoutes[currentProject().id] = route;
  searchInput.value = '';
  setMenu(false);
  const chapter = DATA.chapters.find(item => item.id === route);
  const views = {home, catalog: catalogView, architecture: architectureView, glossary: glossaryView, interview: interviewView, bank: bankView, practice};
  if (!currentProject().ready) pendingProjectView();
  else if (chapter) lesson(chapter);
  else if (views[route]) views[route]();
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
  document.getElementById('page-name').textContent = '搜索结果';
  document.getElementById('page-context').textContent = 'AI 智能体平台 / 项目内搜索';
  const normalized = query.toLowerCase();
  const chapters = DATA.chapters.filter(chapter => chapter.search.toLowerCase().includes(normalized));
  const supplements = [
    {id: 'home', title: '学习指南与路径', content: plain(DATA.guide) + learningRounds.map(round => round.title + round.description).join(' ')},
    {id: 'architecture', title: '知识点任务架构图', content: DATA.architecture.nodes.map(node => node.title + node.description + node.input + node.output).join(' ')},
    {id: 'glossary', title: '常用术语说明', content: DATA.glossary.map(item => item.term + item.explanation).join(' ')},
    ...DATA.extras.filter(extra => ['extra1','extra2','extra4'].includes(extra.id)).map(extra => ({id: extra.id, title: extra.title, content: plain(extra.html)}))
  ].filter(item => (item.title + item.content).toLowerCase().includes(normalized));
  main.innerHTML = `<div class="reader">${pageHeader('项目内搜索', '找到需要的知识。', `“${escapeHTML(query)}” · ${chapters.length} 个知识点，${supplements.length} 篇学习资料`)}${chapters.map(chapter => resultCard(chapter, query)).join('')}${supplements.map(item => `<button class="result" data-route="${item.id}"><span class="result-top">学习总览</span><h3>${escapeHTML(item.title)}</h3><p>查看完整内容 →</p></button>`).join('')}${!chapters.length && !supplements.length ? '<div class="empty"><h3>没有找到匹配内容。</h3><p>试试更短的关键词。</p></div>' : ''}${footer()}</div>`;
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
