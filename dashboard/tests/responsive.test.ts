import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
function declarations(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1];
  assert.ok(block, `CSS owner exists: ${selector}`);
  return new Map([...block.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
}

test('scrolling history table contains absolute accessible names instead of hiding document overflow', () => {
  const table = declarations('.table-wrap');
  assert.equal(table.get('position'), 'relative');
  assert.equal(table.get('min-width'), '0');
  assert.equal(table.get('max-width'), '100%');
  assert.equal(table.get('overflow-x'), 'auto');
  const hiddenName = declarations('.sr-only');
  assert.equal(hiddenName.get('top'), '0');
  assert.equal(hiddenName.get('left'), '0');
  assert.equal(declarations('.filter-fields label').get('min-width'), '0');
  assert.doesNotMatch(css, /(?:html|body)(?:\s*,\s*(?:html|body))*\s*\{[^}]*overflow(?:-x)?:\s*hidden/);
  const history = readFileSync(new URL('../app/dashboard.tsx', import.meta.url), 'utf8');
  assert.match(history, /className="table-wrap" role="region" aria-label="[^"]+" tabIndex=\{0\}/);
});

test('minimal controls keep native radios compact without decorative shell layers', () => {
  const radio = declarations('.radio-card input[type="radio"]');
  assert.equal(radio.get('width'), '20px');
  assert.equal(radio.get('height'), '20px');
  assert.equal(radio.get('flex'), '0 0 20px');
  assert.match(css, /input:not\(\[type="radio"\]\), select, textarea\s*\{/);
  assert.doesNotMatch(css, /\.sidebar\b|radial-gradient|linear-gradient|@keyframes/);
});

function luminance(hex: string) {
  const rgb = hex.match(/../g)!.map(channel => parseInt(channel, 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(foreground: string, background: string) {
  const pair = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (pair[0] + 0.05) / (pair[1] + 0.05);
}
test('actual theme text and control-border tokens meet their scoped contrast thresholds', () => {
  for (const selector of [':root', ':root[data-theme="light"]']) {
    const tokens = declarations(selector);
    function hex(name: string) {
      const value = tokens.get(`--${name}`);
      assert.match(value ?? '', /^#[\da-f]{3}(?:[\da-f]{3})?$/i, name);
      const raw = value!.slice(1);
      return raw.length === 3 ? [...raw].map(character => character.repeat(2)).join('') : raw;
    }
    for (const [foreground, background] of [
      ['ink', 'bg'], ['muted', 'bg'], ['ink', 'surface'], ['muted', 'surface'],
      ['primary-ink', 'accent'], ['accent', 'bg'], ['danger', 'error-bg'], ['notice-ink', 'notice-bg'],
    ]) assert.ok(contrast(hex(foreground), hex(background)) >= 4.5, `${selector}: ${foreground}/${background}`);
    assert.ok(contrast(hex('control-border'), hex('control')) >= 3, `${selector}: control boundary`);
  }
});

test('system light mode resolves the same semantic palette as explicit light mode', () => {
  const light = declarations(':root[data-theme="light"]');
  const system = declarations(':root[data-theme="system"]');
  for (const [name, value] of light) assert.equal(system.get(name), value, name);
});
