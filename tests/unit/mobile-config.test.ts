import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '../../capacitor.config';

const mobileStyles = readFileSync(resolve(process.cwd(), 'mobile/styles.css'), 'utf8');

function cssBlock(selector: string) {
  const marker = `${selector} {`;
  const blocks: string[] = [];
  let offset = 0;
  while (offset < mobileStyles.length) {
    const start = mobileStyles.indexOf(marker, offset);
    if (start < 0) break;
    offset = start + marker.length;
    if (start > 0 && mobileStyles[start - 1] !== '\n') continue;
    const end = mobileStyles.indexOf('}', offset);
    blocks.push(mobileStyles.slice(offset, end));
  }
  if (blocks.length === 0) throw new Error(`Missing CSS selector: ${selector}`);
  return blocks.join('\n');
}

test('Capacitor config requests dark system-bar icons and CSS inset injection', () => {
  expect(config.plugins?.SystemBars).toEqual({
    style: 'LIGHT',
    insetsHandling: 'css',
  });
});

test('mobile layout prefers injected safe-area variables with env fallbacks', () => {
  expect(mobileStyles).toContain('var(--safe-area-inset-top, env(safe-area-inset-top, 0px))');
  expect(mobileStyles).toContain('var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))');
});

test('scan alert wraps unbroken unknown codes inside the mobile viewport', () => {
  const scanError = cssBlock('.scan-error');
  expect(scanError).toContain('max-width: 100%');
  expect(scanError).toContain('overflow-wrap: anywhere');
  expect(scanError).toContain('word-break: break-word');
});

test('unread badge can grow with enlarged text without clipping', () => {
  const unreadBadge = cssBlock('.unread-badge');
  expect(unreadBadge).toContain('min-height: 20px');
  expect(unreadBadge).not.toMatch(/(^|\s)height:\s*20px/);
  expect(unreadBadge).toContain('line-height: 1.2');
});

test('programmatically focused page headings retain a visible focus indicator', () => {
  expect(mobileStyles).toContain('[data-page-heading]:focus-visible');
});
