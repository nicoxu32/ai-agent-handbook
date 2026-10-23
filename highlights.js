(() => {
  const storageKey = 'nico-agent-handbook-highlights-v1';
  const blockSelector = '[data-highlight-key]';
  const markSelector = 'mark.reader-highlight';
  const seen = new WeakSet();
  let entries = readEntries();
  let pending = [];
  let selectionTimer;
  const toolbar = document.createElement('div');
  toolbar.className = 'highlight-toolbar';
  toolbar.hidden = true;
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '选中文字操作');
  toolbar.innerHTML = '<button type="button" data-selection-action="highlight" title="将选中文字标为重点，保存在当前浏览器"><span aria-hidden="true">▰</span>划重点</button><button type="button" data-selection-action="append" hidden>追问</button>';
  const appendButton = toolbar.querySelector('[data-selection-action="append"]');
  document.body.append(toolbar);

  function readEntries() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (!Array.isArray(value)) return [];
      return value.filter(item => item && typeof item.id === 'string' &&
        typeof item.key === 'string' && typeof item.quote === 'string' && item.quote.trim() &&
        typeof item.prefix === 'string' && typeof item.suffix === 'string' &&
        Number.isInteger(item.start) && item.start >= 0 &&
        Number.isInteger(item.end) && item.end === item.start + item.quote.length);
    } catch {
      return [];
    }
  }

  function saveEntries(message) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(entries));
      notify(message);
    } catch {
      notify('本次操作已生效，但浏览器无法保存；刷新后可能丢失。');
    }
  }

  function anchor(block, start, end) {
    const text = block.textContent;
    return {
      id: crypto.randomUUID(), key: block.dataset.highlightKey, start, end,
      quote: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32)
    };
  }

  function locate(entry, text) {
    const contextMatches = start =>
      text.slice(Math.max(0, start - entry.prefix.length), start) === entry.prefix &&
      text.slice(start + entry.quote.length, start + entry.quote.length + entry.suffix.length) === entry.suffix;
    if (text.slice(entry.start, entry.end) === entry.quote && contextMatches(entry.start)) {
      return {start: entry.start, end: entry.end, entry};
    }
    const matches = [];
    let start = text.indexOf(entry.quote);
    while (start !== -1) {
      matches.push(start);
      start = text.indexOf(entry.quote, start + 1);
    }
    const candidates = matches.length === 1 ? matches : matches.filter(contextMatches);
    if (candidates.length !== 1) return null;
    return {start: candidates[0], end: candidates[0] + entry.quote.length, entry};
  }

  function textNodes(block) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let offset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      nodes.push({node, start: offset, end: offset + node.length});
      offset += node.length;
    }
    return nodes;
  }

  function restoreBlock(block) {
    const marks = [...block.querySelectorAll(markSelector)];
    marks.forEach(mark => mark.replaceWith(...mark.childNodes));
    if (marks.length) block.normalize();
    const ranges = entries.filter(entry => entry.key === block.dataset.highlightKey)
      .map(entry => locate(entry, block.textContent)).filter(Boolean).sort((a, b) => a.start - b.start);
    // A changed source may make old anchors overlap. Never nest mark elements.
    let previousEnd = -1;
    const disjoint = ranges.filter(range => {
      if (range.start < previousEnd) return false;
      previousEnd = range.end;
      return true;
    });
    for (const {node, start, end} of textNodes(block)) {
      const hits = disjoint.filter(range => range.start < end && range.end > start);
      if (!hits.length) continue;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const range of hits) {
        const from = Math.max(start, range.start) - start;
        const to = Math.min(end, range.end) - start;
        fragment.append(document.createTextNode(node.data.slice(cursor, from)));
        const mark = document.createElement('mark');
        mark.className = 'reader-highlight';
        mark.dataset.highlightId = range.entry.id;
        mark.textContent = node.data.slice(from, to);
        mark.title = '点击取消重点标记';
        mark.tabIndex = 0;
        mark.setAttribute('role', 'button');
        mark.setAttribute('aria-label', '取消重点标记：' + range.entry.quote.slice(0, 60));
        fragment.append(mark);
        cursor = to;
      }
      fragment.append(document.createTextNode(node.data.slice(cursor)));
      node.replaceWith(fragment);
    }
    seen.add(block);
  }

  function observe() {
    observer.observe(main, {childList: true, subtree: true, characterData: true});
  }

  function restoreBlocks(blocks) {
    observer.disconnect();
    try { blocks.forEach(restoreBlock); }
    finally { observe(); }
  }

  const observer = new MutationObserver(records => {
    const blocks = new Set([...main.querySelectorAll(blockSelector)].filter(block => !seen.has(block)));
    for (const record of records) {
      const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      const block = element?.closest(blockSelector);
      if (block && main.contains(block)) blocks.add(block);
    }
    if (blocks.size) {
      hideToolbar();
      restoreBlocks(blocks);
    }
  });
  observe();

  function hideToolbar() {
    toolbar.hidden = true;
    pending = [];
  }

  function selectedParts(range) {
    const parts = [];
    for (const block of main.querySelectorAll(blockSelector)) {
      if (!block.checkVisibility() || !range.intersectsNode(block)) continue;
      const whole = document.createRange();
      whole.selectNodeContents(block);
      const clipped = whole.cloneRange();
      if (range.compareBoundaryPoints(Range.START_TO_START, whole) > 0) clipped.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, whole) < 0) clipped.setEnd(range.endContainer, range.endOffset);
      const before = whole.cloneRange();
      before.setEnd(clipped.startContainer, clipped.startOffset);
      const start = before.toString().length;
      const quote = clipped.toString();
      if (quote.trim()) parts.push({block, start, end: start + quote.length, quote});
    }
    return parts;
  }

  function updateSelection() {
    if (document.querySelector('dialog[open]') || sidebar.classList.contains('open')) return hideToolbar();
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return hideToolbar();
    const range = selection.getRangeAt(0);
    const elementFor = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!main.contains(range.commonAncestorContainer) ||
        !elementFor(range.startContainer)?.closest(blockSelector) ||
        !elementFor(range.endContainer)?.closest(blockSelector)) return hideToolbar();
    pending = selectedParts(range);
    if (!pending.length) return hideToolbar();
    appendButton.hidden = !appendTargetForSelection(pending);
    toolbar.hidden = false;
    const rect = range.getBoundingClientRect();
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    const topbarBottom = document.querySelector('.topbar').getBoundingClientRect().bottom;
    let top = rect.top - height - 10;
    if (top < topbarBottom + 8) top = rect.bottom + 10;
    toolbar.style.top = Math.max(topbarBottom + 8, Math.min(innerHeight - height - 8, top)) + 'px';
    toolbar.style.left = Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2)) + 'px';
  }

  function addHighlights() {
    const parts = pending.filter(part => main.contains(part.block) &&
      part.block.textContent.slice(part.start, part.end) === part.quote);
    if (!parts.length) return hideToolbar();
    for (const part of parts) {
      let {start, end} = part;
      const existing = entries.filter(entry => entry.key === part.block.dataset.highlightKey)
        .map(entry => locate(entry, part.block.textContent)).filter(Boolean).sort((a, b) => a.start - b.start);
      const replaced = new Set();
      for (const range of existing) {
        if (range.start > end || range.end < start) continue;
        start = Math.min(start, range.start);
        end = Math.max(end, range.end);
        replaced.add(range.entry.id);
      }
      entries = entries.filter(entry => !replaced.has(entry.id));
      entries.push(anchor(part.block, start, end));
    }
    window.getSelection().removeAllRanges();
    hideToolbar();
    restoreBlocks([...main.querySelectorAll(blockSelector)]);
    saveEntries('重点已保存到当前浏览器，点击标记可取消。');
  }

  function removeHighlight(mark) {
    entries = entries.filter(entry => entry.id !== mark.dataset.highlightId);
    hideToolbar();
    restoreBlocks([...main.querySelectorAll(blockSelector)]);
    saveEntries('已取消重点标记。');
  }

  toolbar.addEventListener('pointerdown', event => event.preventDefault());
  toolbar.querySelector('[data-selection-action="highlight"]').addEventListener('click', addHighlights);
  appendButton.addEventListener('click', () => {
    const target = appendTargetForSelection(pending);
    window.getSelection().removeAllRanges();
    hideToolbar();
    if (target) openAppend(target);
  });
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(updateSelection, 140);
  });
  document.addEventListener('pointerup', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(updateSelection, 0);
  });
  document.addEventListener('click', event => {
    const mark = event.target.closest(markSelector);
    if (!mark || !main.contains(mark) || window.getSelection()?.toString()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    removeHighlight(mark);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideToolbar();
    const mark = event.target.closest(markSelector);
    if (mark && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      removeHighlight(mark);
    }
  });
  window.addEventListener('hashchange', hideToolbar);
  window.addEventListener('resize', hideToolbar);
  window.addEventListener('scroll', () => { if (!toolbar.hidden) updateSelection(); }, {passive: true});
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    entries = readEntries();
    hideToolbar();
    restoreBlocks([...main.querySelectorAll(blockSelector)]);
  });
})();
