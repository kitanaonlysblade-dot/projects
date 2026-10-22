import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { LEGAL_DOCS, type LegalDocId } from '../lib/legalDocs';

const IDS = Object.keys(LEGAL_DOCS) as LegalDocId[];

test('every legal document has a public web page', () => {
  for (const id of IDS) {
    const file = new URL(`../app/${id}/page.tsx`, import.meta.url);
    assert.ok(existsSync(file), `/${id} page is missing`);
    assert.match(readFileSync(file, 'utf8'), new RegExp(`doc="${id}"`));
  }
});

test('the documents are not empty and the privacy policy covers scanning and email', () => {
  for (const id of IDS) assert.ok(LEGAL_DOCS[id].sections.length > 0, id);
  const privacy = JSON.stringify(LEGAL_DOCS.privacy);
  assert.match(privacy, /scan a video/);
  assert.match(privacy, /confirmation code|confirm your address/);
});

test('no document shows an unfilled template placeholder', () => {
  for (const id of IDS) assert.doesNotMatch(JSON.stringify(LEGAL_DOCS[id]), /\$\{/, id);
});
