import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('scrolling history table contains absolute accessible names instead of hiding document overflow', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.table-wrap\{position:relative;min-width:0;max-width:100%\}/);
  assert.match(css, /\.sr-only\{top:0;left:0\}/);
  assert.match(css, /\.filter-fields label,\.filter-fields label:last-child\{min-width:0;max-width:100%;width:100%\}/);
  assert.doesNotMatch(css, /(?:html|body)\s*\{[^}]*overflow(?:-x)?:\s*hidden/);
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
test('measured semantic text and control borders meet their scoped contrast thresholds', () => {
  for (const [foreground, background] of [
    ['edf2f7', '181e25'], ['b6c2cf', '181e25'], ['8ac8ff', '101418'],
    ['18232e', 'ffffff'], ['45586b', 'ffffff'], ['155a86', 'f3f6f9'],
  ]) assert.ok(contrast(foreground, background) >= 4.5, `${foreground}/${background}`);
  for (const [foreground, background] of [
    ['66788c', '181e25'], ['66788c', '101418'], ['66788c', '222b35'],
    ['72869a', 'ffffff'], ['72869a', 'f3f6f9'],
  ]) assert.ok(contrast(foreground, background) >= 3, `${foreground}/${background}`);
});
