const termNames = new Map(Object.entries(DATA.terms).map(([term, chinese]) => [term.toLowerCase(), chinese]));
const termPattern = new RegExp('(?<![A-Za-z0-9_])(?:' + Object.keys(DATA.terms)
  .sort((a, b) => b.length - a.length).map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![A-Za-z0-9_])', 'gi');

function termMatches(text) {
  const protectedRanges = [...text.matchAll(/https?:\/\/\S+|\b[\w.+-]+@[\w.-]+\.\w+|\bgpt-[\w.-]+/gi)]
    .map(match => [match.index, match.index + match[0].length]);
  return [...text.matchAll(termPattern)].filter(match => {
    if (protectedRanges.some(([start, end]) => match.index >= start && match.index < end)) return false;
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    if (/^\s*[（(][^（）()\n]{0,80}[\u4e00-\u9fff][^（）()\n]*[）)]/.test(after)) return false;
    return !(/[\u4e00-\u9fff][（(]\s*$/.test(before) && /^\s*[）)]/.test(after));
  }).map(match => ({start: match.index, end: match.index + match[0].length, term: match[0], chinese: termNames.get(match[0].toLowerCase())}));
}

function withChineseTerms(text) {
  let cursor = 0;
  let result = '';
  for (const match of termMatches(text)) {
    result += text.slice(cursor, match.end) + '（' + match.chinese + '）';
    cursor = match.end;
  }
  return result + text.slice(cursor);
}

function updateTermNotes(input) {
  let note = input.parentElement.querySelector('.term-notes');
  if (!note) {
    note = document.createElement('small');
    note.className = 'term-notes';
    input.after(note);
  }
  const terms = [...new Set(termMatches(input.value).map(match => match.term + '（' + match.chinese + '）'))];
  note.textContent = terms.length ? '中文叫法：' + terms.join('；') : '';
  note.hidden = !terms.length;
}

// Index the same Chinese names readers see without changing source content.
for (const chapter of DATA.chapters) chapter.search = withChineseTerms(chapter.search);
for (const question of DATA.doubao.questions) question.search = withChineseTerms(question.search);

(() => {
  const skip = 'script,style,textarea,input,select,pre,code,svg,.term-label,.term-notes,.brand-mark,kbd,[data-raw-text],[contenteditable],.document-toolbar';
  function annotate() {
    observer.disconnect();
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.parentElement.closest(skip)) nodes.push(walker.currentNode);
      }
      for (const node of nodes) {
        const matches = termMatches(node.data);
        if (!matches.length) continue;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const match of matches) {
          fragment.append(document.createTextNode(node.data.slice(cursor, match.start)));
          const span = document.createElement('span');
          span.className = 'term-label';
          span.dataset.chinese = '（' + match.chinese + '）';
          span.setAttribute('aria-label', match.term + '，' + match.chinese);
          span.textContent = match.term;
          fragment.append(span);
          cursor = match.end;
        }
        fragment.append(document.createTextNode(node.data.slice(cursor)));
        node.replaceWith(fragment);
      }
      for (const option of document.querySelectorAll('option')) {
        const translated = withChineseTerms(option.textContent);
        if (translated !== option.textContent) option.textContent = translated;
      }
      for (const input of document.querySelectorAll('input[placeholder]')) {
        input.placeholder = withChineseTerms(input.placeholder);
      }
      document.title = withChineseTerms(document.title);
    } finally {
      observer.observe(document.body, {childList: true, subtree: true, characterData: true});
    }
  }
  const observer = new MutationObserver(annotate);
  annotate();
})();
