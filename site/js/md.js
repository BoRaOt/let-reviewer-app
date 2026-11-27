/* Small Markdown renderer for the lesson files (headings, paragraphs, lists, bold, italic,
   code, links, and [SRC-xxxx, pinpoint] citations). No external libraries. */
(function () {
  'use strict';
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function srcTitle(id) {
    var s = window.SOURCES && window.SOURCES[id];
    return s ? s.title + ' — ' + s.by + ' (' + s.lic + ')' : id;
  }
  function inline(t) {
    t = esc(t);
    // citations like [SRC-0016, Sec. 14] or [SRC-0001, Annex A; SRC-0002]
    t = t.replace(/\[(SRC-\d{4}[^\]]*)\]/g, function (m, body) {
      var ids = body.match(/SRC-\d{4}/g) || [];
      return '<span class="cite" title="' + esc(ids.map(srcTitle).join(' | ')) + '">' + body + '</span>';
    });
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
    t = t.replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
    t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return t;
  }
  function render(md) {
    var lines = String(md || '').replace(/\r/g, '').split('\n');
    var html = [], para = [], list = null;
    function flushPara() { if (para.length) { html.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } }
    function flushList() { if (list) { html.push('<' + list.tag + '>' + list.items.map(function (i) { return '<li>' + inline(i) + '</li>'; }).join('') + '</' + list.tag + '>'); list = null; } }
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      var m;
      if (!line.trim()) { flushPara(); flushList(); return; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        flushPara(); flushList();
        var lvl = Math.min(4, m[1].length + 1);
        html.push('<h' + lvl + '>' + inline(m[2]) + '</h' + lvl + '>');
        return;
      }
      if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
        flushPara();
        if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
        list.items.push(m[1]);
        return;
      }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara();
        if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
        list.items.push(m[1]);
        return;
      }
      if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ' ' + line.trim(); return; }
      flushList();
      para.push(line.trim());
    });
    flushPara(); flushList();
    return html.join('\n');
  }
  // Split a lesson into its numbered sections: {intro, '1': md, '2': md, ...}
  function sections(md) {
    var out = { intro: '' }, cur = 'intro';
    String(md || '').split('\n').forEach(function (l) {
      var m = l.match(/^##\s+(\d)\.\s/);
      if (m) { cur = m[1]; out[cur] = ''; return; }
      out[cur] += l + '\n';
    });
    return out;
  }
  window.MD = { render: render, inline: inline, esc: esc, sections: sections };
})();
