/**
 * Notes widget — a Markdown sticky note.
 *
 * Fully self-contained module: click the rendered note (or the pencil in the
 * card toolbar) to edit raw Markdown; editing auto-saves into the widget
 * instance config and Esc returns to the rendered preview. Rendering is a
 * small built-in Markdown pipeline (see renderMarkdown), no dependencies.
 *
 * Config persistence is event-driven: the widget dispatches
 * `newey:widget-config` on its container and the dashboard core routes it to
 * the widget manager (see newey.js / module-api.js docs).
 */

import { BaseWidget, defineWidget } from '../js/module-api.js';
import { el, debounce } from '../js/utils.js';

const DEFAULT_NOTE = [
  '# Notes',
  '',
  'Click the note to edit — **Markdown** works.',
  '',
  '- Lists, `code`, [links](https://example.com)',
  '- Quotes, tables, headings and hr',
].join('\n');

/* ------------------------------------------------------------------ *
 * Markdown renderer (CommonMark-ish subset, HTML-safe)
 * ------------------------------------------------------------------ */

const H_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*(\S+)?\s*$/;
const HR_RE = /^ {0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/;
const QUOTE_RE = /^ {0,3}>/;
const UL_RE = /^([ \t]*)([-*+])[ \t]+(.*)$/;
const OL_RE = /^([ \t]*)(\d{1,9})[.)][ \t]+(.*)$/;

function escHtml(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Inline span rendering: escape, protect code spans, then inline syntax. */
function inlineIt(raw) {
  const codes = [];
  let s = escHtml(raw).replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // images and links accept only http(s)/mailto URLs — anything else (e.g.
  // javascript:) stays visible as literal text instead of becoming a link
  s = s
    .replace(
      /!\[([^\]]*)\]\(\s*((?:https?:\/\/|mailto:)[^\s)]+)\s*\)/g,
      (_, alt, url) => `<img src="${url}" alt="${alt}" loading="lazy">`
    )
    .replace(
      /\[([^\]]+)\]\(\s*((?:https?:\/\/|mailto:)[^\s)]+)(?:\s+&#34;([\s\S]*?)&#34;)?\s*\)/g,
      (_, text, url, title) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ''}>${text}</a>`
    )
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w'’_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${codes[Number(n)]}</code>`);
}

/** Normalised indent width (tabs count as two spaces). */
const indentOf = (line) => (line.match(/^[ \t]*/) ?? [''])[0].replace(/\t/g, '  ').length;

/**
 * Parse <ul>/<ol> runs with nesting. Returns [html, nextIndex].
 * Item text may span lazily-indented continuation lines; a deeper-indented
 * list line opens a child list of the current item.
 */
function parseList(lines, start) {
  const isUl = UL_RE.test(lines[start]);
  const re = isUl ? UL_RE : OL_RE;
  const baseIndent = indentOf(lines[start]);
  const items = [];
  let cur = null;
  let i = start;

  const flush = () => { if (cur) { items.push(cur); cur = null; } };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // blank — list continues only if the next real line belongs to it
      let j = i;
      while (j < lines.length && !lines[j].trim()) j++;
      const nm = j < lines.length && (lines[j].match(UL_RE) ?? lines[j].match(OL_RE));
      if (nm && indentOf(lines[j]) >= baseIndent) { i = j; continue; }
      break;
    }
    const m = line.match(re);
    const other = m ? null : (line.match(UL_RE) ?? line.match(OL_RE));
    if (m && indentOf(line) === baseIndent) {
      flush();
      cur = { text: [m[3]], children: [] };
      i++;
    } else if ((m ?? other) && indentOf(line) > baseIndent) {
      const [child, ni] = parseList(lines, i);
      (cur ??= { text: [], children: [] }).children.push(child);
      i = ni;
    } else if (cur && indentOf(line) > baseIndent) {
      cur.text.push(line.trim()); // continuation text of the current item
      i++;
    } else {
      break;
    }
  }
  flush();

  const tag = isUl ? 'ul' : 'ol';
  const html = `<${tag}>${items
    .map((it) => `<li>${inlineIt(it.text.join(' '))}${it.children.join('')}</li>`)
    .join('')}</${tag}>`;
  return [html, i];
}

/** GFM-style table? Line must have a pipe and the next line a |---| row. */
function isTableSep(line) {
  const cells = line.split('|');
  if (cells.length < 2) return false;
  // edge cells before a leading "|" / after a trailing "|" are empty by design
  return cells.every((c) => !c.trim() || /^\s*:?-{1,}:?\s*$/.test(c)) && /-/.test(line);
}

const splitRow = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/**
 * Render a Markdown string to a trusted HTML fragment (all source text is
 * escaped; only generated tags and whitelisted link/image URLs survive).
 * Supports: headings, paragraphs, bold/italic/del, `code`, fenced blocks,
 * lists (nested), blockquotes, tables, thematic breaks, links/images.
 * @param {string} md
 * @returns {string}
 */
export function renderMarkdown(md) {
  const src = String(md ?? '').replace(/\r\n?/g, '\n');
  if (!src.trim()) return '';
  const lines = src.split('\n');
  let html = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m;
    if ((m = line.match(FENCE_RE))) {
      const fence = m[1];
      const closer = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`);
      const body = [];
      i++;
      while (i < lines.length && !closer.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip the closing fence (or EOF)
      html += `<pre><code>${escHtml(body.join('\n'))}</code></pre>`;
    } else if ((m = line.match(H_RE))) {
      html += `<h${m[1].length}>${inlineIt(m[2])}</h${m[1].length}>`;
      i++;
    } else if (HR_RE.test(line)) {
      html += '<hr>';
      i++;
    } else if (QUOTE_RE.test(line)) {
      const inner = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        inner.push(lines[i].replace(/^ {0,3}> ?/, ''));
        i++;
      }
      html += `<blockquote>${renderMarkdown(inner.join('\n'))}</blockquote>`;
    } else if (UL_RE.test(line) || OL_RE.test(line)) {
      const [list, ni] = parseList(lines, i);
      html += list;
      i = ni;
    } else if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const cells = (cellsList, tag) => cellsList.map((c) => `<${tag}>${inlineIt(c)}</${tag}>`).join('');
      html += `<table><thead><tr>${cells(head, 'th')}</tr></thead><tbody>` +
        rows.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('') + '</tbody></table>';
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() &&
        !H_RE.test(lines[i]) && !FENCE_RE.test(lines[i]) && !HR_RE.test(lines[i]) &&
        !QUOTE_RE.test(lines[i]) && !UL_RE.test(lines[i]) && !OL_RE.test(lines[i])) {
        // 2+ trailing spaces = hard line break (marked \u0001, applied post-escape)
        para.push(lines[i].replace(/[ \t]{2,}$/, '\u0001'));
        i++;
      }
      html += `<p>${inlineIt(para.join('\n').replace(/\n/g, ' ')).replace(/\u0001 ?/g, '<br>')}</p>`;
    }
  }
  return html;
}

/* ------------------------------------------------------------------ *
 * Widget
 * ------------------------------------------------------------------ */

class MarkdownNotes extends BaseWidget {
  static id = 'newey.widget.notes';
  static name = 'Notes';
  static description = 'A sticky note written in Markdown. Click the note to edit.';
  static defaultWidth = 3;
  static defaultHeight = 2;
  static defaultConfig = {
    content: DEFAULT_NOTE,
  };

  /** While true, onRender must not rebuild the body (editor is live). */
  #editing = false;
  #editor = null;

  onRender() {
    if (!this.body) return;
    if (this.#editing) return;
    const content = this.config.content ?? '';

    this.body.classList.add('notes');
    this.body.innerHTML = '';
    const view = el('div', { class: 'notes-view' });
    if (content.trim()) {
      view.innerHTML = renderMarkdown(content);
    } else {
      view.append(el('span', { class: 'notes-empty', text: 'Click to write\u2026' }));
    }
    // selecting text must not drag the card; a click (without a selection
    // made) opens the editor
    view.addEventListener('pointerdown', (e) => e.stopPropagation());
    view.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const sel = String(getSelection?.() ?? '');
      if (sel) return;
      this.#openEditor();
    });
    this.body.append(view);
    this.#mountToolbarButton();
  }

  #openEditor() {
    this.#editing = true;
    this.body.classList.add('notes');
    this.body.innerHTML = '';

    const ta = el('textarea', { class: 'notes-editor', spellcheck: 'false' });
    ta.value = this.config.content ?? '';
    const hint = el('div', { class: 'notes-hint', text: 'Saving automatically \u00b7 Esc when done' });
    this.body.append(ta, hint);
    this.#editor = ta;
    this.#syncToolbarButton(true);

    const save = debounce(() => this.#save(ta.value), 500);
    ta.addEventListener('input', () => {
      save();
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.#closeEditor(); }
    });

    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  #closeEditor() {
    const value = this.#editor?.value ?? this.config.content ?? '';
    this.#editing = false;
    this.#editor = null;
    this.#save(value);
    this.onRender();
  }

  /** Persist the content as this instance's config (core writes the layout). */
  #save(content) {
    this.config = { ...this.config, content };
    this.container?.dispatchEvent(new CustomEvent('newey:widget-config', {
      detail: { id: this.id, config: this.config },
      bubbles: true,
    }));
  }

  /** Pencil/Done button in the card toolbar (core renders gear + remove). */
  #mountToolbarButton() {
    const toolbar = this.container?.querySelector('.widget-toolbar');
    if (!toolbar) return;
    if (!toolbar.querySelector('.widget-btn--notes-edit')) {
      toolbar.prepend(el('button', {
        class: 'widget-btn widget-btn--notes-edit',
        type: 'button',
        onclick: (e) => {
          e.stopPropagation();
          if (this.#editing) this.#closeEditor();
          else this.#openEditor();
        },
      }));
    }
    this.#syncToolbarButton(this.#editing);
  }

  #syncToolbarButton(editing) {
    const btn = this.container?.querySelector('.widget-btn--notes-edit');
    if (!btn) return;
    btn.innerHTML = editing ? ICONS.check : ICONS.pencil;
    btn.title = editing ? 'Done editing' : 'Edit note';
  }
}

const ICONS = {
  pencil:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-4.2L16.6 4.4a2 2 0 0 1 3 3L8 18.9 4 20z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 6.5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export default defineWidget(MarkdownNotes);
