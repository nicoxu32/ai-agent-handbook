// Bundle this module locally with npm run build:editor; no CDN is used at runtime.
import {Editor, mergeAttributes} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Blockquote from '@tiptap/extension-blockquote';
import {TableKit} from '@tiptap/extension-table';

const labels = {KEY: '核心理解', NOTE: '重点摘记', TIP: '边界与易错点', SUPPLEMENT: '补充理解'};
const Callout = Blockquote.extend({
  addAttributes() {
    return {kind: {
      default: null,
      parseHTML: element => labels[element.getAttribute('data-callout')] ? element.getAttribute('data-callout') : null,
      renderHTML: attributes => attributes.kind ? {
        'data-callout': attributes.kind,
        'data-label': labels[attributes.kind],
        class: 'reading-callout callout-' + attributes.kind.toLowerCase()
      } : {}
    }};
  },
  renderHTML({HTMLAttributes}) { return ['blockquote', mergeAttributes(HTMLAttributes), 0]; }
});
const LocalImage = Image.extend({
  addAttributes() {
    return {...this.parent?.(), src: {
      default: null,
      parseHTML: element => element.getAttribute('src'),
      renderHTML: attributes => ({src: attributes.src})
    }};
  }
}).configure({allowBase64: false, HTMLAttributes: {class: 'reading-image'}});

export function create(element, content, options) {
  const extensions = [StarterKit.configure({
    blockquote: false,
    strike: false,
    link: {openOnClick: false, autolink: false, defaultProtocol: 'https'},
    heading: {levels: [1, 2, 3, 4, 5, 6]}
  }), Callout, LocalImage, TableKit.configure({table: {resizable: false}})];
  const editor = new Editor({
    element, extensions, content,
    editorProps: {attributes: {class: 'prose document-surface', 'aria-label': options.label, role: 'textbox', 'aria-multiline': 'true'}},
    onFocus: () => options.onFocus(editor),
    onSelectionUpdate: () => options.onSelect(editor),
    onUpdate: () => options.onChange(editor)
  });
  return editor;
}

export function command(editor, action) {
  const chain = editor.chain().focus();
  switch (action) {
    case 'undo': return chain.undo().run();
    case 'redo': return chain.redo().run();
    case 'paragraph': return chain.setParagraph().run();
    case 'heading2': return chain.toggleHeading({level: 2}).run();
    case 'heading3': return chain.toggleHeading({level: 3}).run();
    case 'bold': return chain.toggleBold().run();
    case 'underline': return chain.toggleUnderline().run();
    case 'code': return chain.toggleCode().run();
    case 'codeBlock': return chain.toggleCodeBlock().run();
    case 'number': return chain.toggleOrderedList().run();
    case 'bullet': return chain.toggleBulletList().run();
    case 'quote':
      if (editor.isActive('blockquote', {kind: null})) return chain.toggleBlockquote().run();
      if (editor.isActive('blockquote')) return chain.updateAttributes('blockquote', {kind: null}).run();
      return chain.setBlockquote().run();
    case 'block':
      if (editor.isActive('blockquote', {kind: 'NOTE'})) return chain.toggleBlockquote().run();
      if (editor.isActive('blockquote')) return chain.updateAttributes('blockquote', {kind: 'NOTE'}).run();
      return chain.wrapIn('blockquote', {kind: 'NOTE'}).run();
    case 'table': return chain.insertTable({rows: 3, cols: 3, withHeaderRow: true}).run();
    case 'addRow': return chain.addRowAfter().run();
    case 'addColumn': return chain.addColumnAfter().run();
    case 'deleteRow': return chain.deleteRow().run();
    case 'deleteColumn': return chain.deleteColumn().run();
    case 'deleteTable': return chain.deleteTable().run();
    default: return false;
  }
}
