import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { theme } from 'antd';
import { antTheme } from '../lib/ant-theme';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('real Ant Design owns the table and SSR registry, not copied native table shells', () => {
  const dashboard = source('../app/dashboard.tsx');
  assert.match(dashboard, /from ['"]antd['"]/);
  assert.match(dashboard, /<Table(?:\s|<)/);
  assert.match(dashboard, /pagination=\{false\}/);
  assert.doesNotMatch(dashboard, /<table\b|<thead\b|<tbody\b/);
  assert.match(source('../app/layout.tsx'), /<AntdRegistry><AntProvider>/);
  assert.match(source('../app/ant-provider.tsx'), /<ConfigProvider/);
});

test('composition CSS does not repaint native controls or mask document overflow', () => {
  const css = source('../app/globals.css');
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:button|input|select|textarea|table|th|td)(?:[\s,.:{])/);
  assert.doesNotMatch(css, /(?:html|body)(?:\s*,\s*(?:html|body))*\s*\{[^}]*overflow(?:-x)?:\s*hidden/);
  assert.doesNotMatch(css, /!important|radial-gradient|linear-gradient|@keyframes/);
});

test('Ant Radio.Group owns the stable native importance field name', () => {
  assert.match(source('../app/test/test-composer.tsx'), /<Radio\.Group name="importance"/);
});

function luminance(hex: string) {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? [...raw].map(value => value.repeat(2)).join('') : raw;
  assert.match(full, /^[\da-f]{6}$/i);
  const rgb = full.match(/../g)!.map(channel => parseInt(channel, 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(foreground: string, background: string) {
  const pair = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (pair[0] + 0.05) / (pair[1] + 0.05);
}

test('resolved Ant Design algorithms retain scoped text and field-boundary contrast', () => {
  for (const dark of [true, false]) {
    const token = theme.getDesignToken(antTheme(dark));
    for (const [foreground, background] of [
      [token.colorText, token.colorBgLayout],
      [token.colorTextSecondary, token.colorBgLayout],
      [token.colorText, token.colorBgContainer],
      [token.colorTextSecondary, token.colorBgContainer],
      [token.colorTextDescription, token.colorBgContainer],
      [token.colorLink, token.colorBgLayout],
      [token.colorLink, token.colorBgContainer],
      [token.colorTextLightSolid, token.colorPrimary],
      [token.colorTextLightSolid, token.colorError],
    ]) assert.ok(contrast(foreground, background) >= 4.5, `${dark ? 'dark' : 'light'} ${foreground}/${background}`);
    assert.ok(contrast(token.colorBorder, token.colorBgContainer) >= 3);
    assert.equal(token.controlHeight, 44);
    assert.equal(token.motion, false);
  }
});

test('filled Ant status Tags use readable semantic foregrounds, not the bright solid-button seed', () => {
  for (const dark of [true, false]) {
    const config = antTheme(dark);
    const token = theme.getDesignToken(config);
    const tag = config.components?.Tag;
    assert.ok(contrast(tag?.colorSuccess ?? token.colorSuccess, token.colorSuccessBg) >= 4.5);
    assert.ok(contrast(tag?.colorWarning ?? token.colorWarning, token.colorWarningBg) >= 4.5);
    assert.ok(contrast(tag?.colorError ?? token.colorError, token.colorErrorBg) >= 4.5);
  }
});
