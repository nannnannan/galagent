import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../../runtime/renderer/markdown';

const tags = (html: string) => [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map(m => m[1].toLowerCase());
const allowed = new Set(['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'span', 'hr']);

test('raw HTML is always escaped, never emitted', () => {
  for (const evil of ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '**<b onclick="x">hi</b>**', '`<svg onload=alert(1)>`', '```\n<iframe src="javascript:alert(1)">\n```', '- <a href="javascript:alert(1)">x</a>', '> <style>*{}</style>']) {
    const html = renderMarkdown(evil);
    assert.ok(tags(html).every(t => allowed.has(t)), `unexpected tag in ${html}`);
    assert.doesNotMatch(html, /<(img|script|svg|iframe|a|style|b)\b/i);
    assert.doesNotMatch(html, /<[^>]*\son\w+=/i, html);
  }
});
test('links render as inert text and cannot break out of the title attribute', () => {
  const html = renderMarkdown('[点我](javascript:alert`1`) [x]("onmouseover="alert)');
  assert.doesNotMatch(html, /href=/);
  assert.doesNotMatch(html, /"onmouseover="/);
  assert.match(html, /<span class="md-link" title="javascript:alert`1`">点我<\/span>/);
});
test('supports the chat subset', () => {
  assert.equal(renderMarkdown('**粗** 和 *斜* 还有 `code` ~~删~~'), '<p><strong>粗</strong> 和 <em>斜</em> 还有 <code>code</code> <del>删</del></p>');
  assert.equal(renderMarkdown('一行\n两行\n\n新段'), '<p>一行<br>两行</p><p>新段</p>');
  assert.equal(renderMarkdown('- 甲\n- 乙\n1. 一\n2. 二'), '<ul><li>甲</li><li>乙</li></ul><ol><li>一</li><li>二</li></ol>');
  assert.equal(renderMarkdown('```js\nconst a = 1 < 2;\n**not bold**\n```'), '<pre data-lang="js"><code>const a = 1 &lt; 2;\n**not bold**</code></pre>');
  assert.equal(renderMarkdown('`**x**`'), '<p><code>**x**</code></p>');
  assert.equal(renderMarkdown('2*3*4 = 24'), '<p>2*3*4 = 24</p>');
  assert.equal(renderMarkdown('> 引用'), '<blockquote>引用</blockquote>');
  assert.equal(renderMarkdown('```\nunclosed'), '<pre><code>unclosed</code></pre>');
});
test('emphasis never reaches into a link title', () => {
  const html = renderMarkdown('[a](-*y) *z* [b](q**r) **s**');
  assert.doesNotMatch(html, /title="[^"]*</, html);
  assert.match(html, /<em>z<\/em>/);
});
