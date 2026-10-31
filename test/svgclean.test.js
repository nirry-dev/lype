import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanSvg } from '../web/lib/svgclean.js';

test('keeps whitelisted shapes and attributes', () => {
  const { svg, shapes } = cleanSvg('<svg viewBox="0 0 100 100" width="9"><rect width="100" height="100" fill="#123"/><circle cx="5" cy="5" r="3" fill="red" stroke-width="2"/></svg>');
  assert.equal(shapes, 2);
  assert.equal(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#123"/><circle cx="5" cy="5" r="3" fill="red" stroke-width="2"/></svg>',
  );
});

test('keeps paint set on the root, which every shape inherits, but not its size', () => {
  const { svg } = cleanSvg('<svg viewBox="0 0 64 64" width="64" height="64" stroke="#333" fill="none" stroke-width="2" onload="x()"><rect x="10" y="14" width="44" height="32"/></svg>');
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" stroke="#333" fill="none" stroke-width="2"><rect x="10" y="14" width="44" height="32"/></svg>');
});

test('strips scripts, handlers, foreign content and external references', () => {
  const evil = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
    <script>alert(1)</script>
    <foreignObject><div onclick="x()"><circle r="9"/></div></foreignObject>
    <a href="javascript:alert(1)"><rect width="5" height="5"/></a>
    <rect width="10" height="10" fill="url(https://evil.example/x.svg#a)" onclick="alert(1)" style="fill: url(javascript:alert(1)); stroke: blue"/>
    <image href="https://evil.example/p.png"/>
    <use href="#x"/>
  </svg>`;
  const { svg, shapes } = cleanSvg(evil);
  assert.equal(shapes, 1, 'only the plain rect survives; content inside disallowed elements is dropped');
  for (const bad of ['script', 'onload', 'onclick', 'foreignObject', 'javascript', 'href', 'evil', '<a', 'image', 'use']) {
    assert.ok(!svg.includes(bad), `${bad} should be gone: ${svg}`);
  }
  assert.ok(svg.includes('stroke="blue"'), 'safe style declarations become attributes');
});

test('gradients keep local url(#id) references, prefixed', () => {
  const { svg } = cleanSvg(
    '<svg><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="5" height="5" fill="url(#g)"/></svg>',
    { idPrefix: 'w1-' },
  );
  assert.ok(svg.includes('id="w1-g"'));
  assert.ok(svg.includes('fill="url(#w1-g)"'));
});

test('half-streamed drawings render what is finished so far', () => {
  const partial = '<svg viewBox="0 0 512 512"><rect width="512" height="512" fill="#000"/><g fill="blue"><circle cx="10" cy="10" r="5"/><path d="M 0 0 L 10';
  const { svg, shapes } = cleanSvg(partial, { partial: true });
  assert.equal(shapes, 2);
  assert.ok(svg.endsWith('</g></svg>'));
});

test('text before the svg and after it is ignored; no svg means nothing', () => {
  assert.equal(cleanSvg('Here is my drawing:\n```svg\n<svg><circle r="4"/></svg>\n```').shapes, 1);
  assert.deepEqual(cleanSvg('I could not draw today.'), { svg: '', shapes: 0 });
});

test('shapes written with explicit closing tags are still closed exactly once', () => {
  const { svg } = cleanSvg('<svg><rect width="1" height="1"></rect><g><circle r="1"></circle></g></svg>');
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="1" height="1"/><g><circle r="1"/></g></svg>');
});
