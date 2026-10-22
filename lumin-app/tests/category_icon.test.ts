import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Reads the rules out of the component source so the test needs no React/lucide.
const src = readFileSync(new URL('../components/CategoryIcon.tsx', import.meta.url), 'utf8');
const rules = [...src.matchAll(/\[\/(.+?)\/i, (\w+)(?:, '[\w-]+')?\],/g)].map((m) => [new RegExp(m[1], 'i'), m[2]] as const);
const pick = (name: string) => rules.find(([re]) => re.test(name))?.[1] ?? 'Tag';

test('seeded categories get distinct, fitting icons', () => {
  assert.equal(pick('Apparel'), 'Shirt');
  assert.equal(pick('Electronics'), 'Smartphone');
  assert.equal(pick('Home & Living'), 'Home');
  assert.equal(pick('Accessories'), 'Gem');
  assert.equal(pick('Fashion'), 'Shirt');
  assert.equal(pick('Beauty'), 'Sparkles');
  assert.equal(pick('Pet Supplies'), 'PawPrint');
});

test('unknown categories fall back to the tag', () => {
  assert.equal(pick('Zzz Misc'), 'Tag');
});

test('every icon the rules use is imported', () => {
  const imported = src.match(/import \{([^}]+)\} from 'lucide-react'/)![1].split(',').map((s) => s.trim());
  for (const [, icon] of rules) assert.ok(imported.includes(icon), icon);
});
