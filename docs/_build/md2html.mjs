// 轻量 Markdown -> HTML 转换器（无第三方依赖）
// 用途：把 docs/*.md 转成带样式的 HTML，再交给 Word 另存为 .docx
// 用法：node md2html.mjs <input.md> <output.html>
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('用法: node md2html.mjs <input.md> <output.html>');
  process.exit(1);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, (_m, p) => `<code>${p}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, p) => `<strong>${p}</strong>`);
  return out;
}

const isTableSep = (l) => /^\|[\s:|-]+\|$/.test(l.trim());
const isFence = (l) => /^\s*```/.test(l);
const isHeading = (l) => /^#{1,6}\s+/.test(l);
const isHr = (l) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l);
const isTableRow = (l) => l.trim().startsWith('|');
const isUl = (l) => /^\s*[-*]\s+/.test(l);
const isOl = (l) => /^\s*\d+\.\s+/.test(l);
const isQuote = (l) => /^\s*>\s?/.test(l);

const splitRow = (line) => {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
};

const src = readFileSync(input, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const lines = src.split('\n');
const html = [];
let i = 0;

while (i < lines.length) {
  const line = lines[i];

  if (!line.trim()) { i++; continue; }

  // 代码块
  if (isFence(line)) {
    i++;
    const buf = [];
    while (i < lines.length && !isFence(lines[i])) { buf.push(lines[i]); i++; }
    i++; // 跳过结束围栏
    html.push(`<pre class="code"><code>${esc(buf.join('\n'))}</code></pre>`);
    continue;
  }

  // 标题
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) {
    const lv = h[1].length;
    html.push(`<h${lv}>${inline(h[2].trim())}</h${lv}>`);
    i++;
    continue;
  }

  // 分隔线
  if (isHr(line)) { html.push('<hr/>'); i++; continue; }

  // 表格
  if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
    const head = splitRow(line);
    i += 2;
    const rows = [];
    while (i < lines.length && isTableRow(lines[i]) && lines[i].trim()) {
      rows.push(splitRow(lines[i]));
      i++;
    }
    const thead = `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${rows
      .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
      .join('')}</tbody>`;
    html.push(`<table>${thead}${tbody}</table>`);
    continue;
  }

  // 引用
  if (isQuote(line)) {
    const buf = [];
    while (i < lines.length && isQuote(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
    html.push(`<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`);
    continue;
  }

  // 无序列表
  if (isUl(line)) {
    const buf = [];
    while (i < lines.length && isUl(lines[i])) { buf.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
    html.push(`<ul>${buf.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
    continue;
  }

  // 有序列表
  if (isOl(line)) {
    const buf = [];
    while (i < lines.length && isOl(lines[i])) { buf.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
    html.push(`<ol>${buf.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
    continue;
  }

  // 普通段落（行尾两个空格 = 软换行）
  const buf = [];
  while (
    i < lines.length &&
    lines[i].trim() &&
    !isFence(lines[i]) && !isHeading(lines[i]) && !isHr(lines[i]) &&
    !isQuote(lines[i]) && !isUl(lines[i]) && !isOl(lines[i]) &&
    !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))
  ) {
    buf.push(lines[i]);
    i++;
  }
  const body = buf
    .map((t, idx) => (idx < buf.length - 1 && / {2,}$/.test(t) ? `${inline(t.trimEnd())}<br/>` : inline(t.trim())))
    .join('');
  html.push(`<p>${body}</p>`);
}

const css = `
@page { size: A4; margin: 2.2cm 2.0cm 2.2cm 2.0cm; }
body { font-family: "微软雅黑", "Microsoft YaHei", "Segoe UI", sans-serif; font-size: 10.5pt; line-height: 1.65; color: #1f2328; }
h1 { font-size: 24pt; text-align: center; margin: 0 0 18pt 0; color: #4338ca; }
h2 { font-size: 17pt; color: #4338ca; border-bottom: 1.5pt solid #c7d2fe; padding-bottom: 4pt; margin: 20pt 0 10pt 0; page-break-before: always; }
h3 { font-size: 13pt; color: #312e81; margin: 14pt 0 8pt 0; }
h4 { font-size: 11.5pt; color: #312e81; margin: 12pt 0 6pt 0; }
p { margin: 6pt 0; }
ul, ol { margin: 6pt 0 6pt 0; padding-left: 22pt; }
li { margin: 3pt 0; }
strong { color: #111827; }
code { font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; background: #f1f2f6; padding: 0 2pt; }
pre.code { font-family: Consolas, "Courier New", monospace; font-size: 8.5pt; line-height: 1.35; white-space: pre; background: #f6f8fa; border: 0.75pt solid #d8dee4; padding: 8pt; margin: 8pt 0; }
pre.code code { background: transparent; font-size: 8.5pt; padding: 0; }
table { border-collapse: collapse; width: 100%; font-size: 9.5pt; margin: 8pt 0; }
th, td { border: 0.75pt solid #9aa3ad; padding: 3.5pt 6pt; vertical-align: top; }
th { background: #e8ecf6; font-weight: bold; }
blockquote { border-left: 3pt solid #6366f1; background: #f7f7fd; margin: 8pt 0; padding: 6pt 12pt; }
blockquote p { margin: 0; }
hr { border: none; border-top: 0.75pt solid #d0d7de; margin: 14pt 0; }
`;

const doc = `\uFEFF<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>高校学生AI就业辅助系统 开发手册</title>
<style>${css}</style>
</head>
<body>
${html.join('\n')}
</body>
</html>
`;

writeFileSync(output, doc, 'utf8');
console.log(`OK  ${input} -> ${output}`);
console.log(`blocks: ${html.length}`);
