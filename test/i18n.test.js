import assert from 'node:assert/strict';
import test from 'node:test';
import { direction, isLanguage, LANGUAGES, strings, translate } from '../shared/i18n.js';

test('every language has the same keys, with the same placeholders, and no empty text', () => {
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const language of Object.keys(LANGUAGES)) {
    assert.deepEqual(Object.keys(strings[language]).sort(), Object.keys(strings.en).sort(), language + ' keys');
    for (const [key, text] of Object.entries(strings[language])) {
      assert.ok(text.trim(), language + ' ' + key + ' is empty');
      assert.deepEqual(placeholders(text), placeholders(strings.en[key]), language + ' ' + key + ' placeholders');
    }
  }
});

test('translate fills placeholders and falls back to English, then to the key', () => {
  assert.equal(translate('en', 'roundNumber', { round: 3 }), 'Round 3');
  assert.equal(translate('he', 'roundNumber', { round: 3 }), 'סבב 3');
  assert.equal(translate('fr', 'roundNumber', { round: 2 }), 'Round 2');
  assert.equal(translate('he', 'no such key'), 'no such key');
});

test('Hebrew reads right to left', () => {
  assert.equal(direction('he'), 'rtl');
  assert.equal(direction('en'), 'ltr');
  assert.ok(isLanguage('he') && isLanguage('en') && !isLanguage('fr') && !isLanguage('toString'));
});

test('every key the client asks for exists', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const directory = new URL('../src/', import.meta.url);
  const used = new Set();
  for (const file of (await readdir(directory)).filter(name => name.endsWith('.jsx'))) {
    const source = await readFile(new URL(file, directory), 'utf8');
    // Quoted words inside t(...) calls, including both arms of t(condition ? 'a' : 'b'), but not values compared against.
    for (const [, args] of source.matchAll(/\bt\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
      for (const [, key] of args.matchAll(/(?<![=!]==\s*)'(\w+)'/g)) used.add(key);
    }
  }
  assert.ok(used.size > 50, 'found the t() calls');
  for (const key of used) assert.ok(Object.hasOwn(strings.en, key), 'missing key ' + key);
});
