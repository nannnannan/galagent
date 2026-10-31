import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCard, completeCard, isEmptyCard } from '../../runtime/renderer/persona-editor';
import { emptyCard } from '../../runtime/shared/personas';

test('an untouched or whitespace-only card counts as empty', () => {
  assert.ok(isEmptyCard(undefined));
  assert.ok(isEmptyCard(emptyCard()));
  const blank = { ...emptyCard(), base: '  ', main: [' '], derivations: [{ trait: '温柔', text: '  ' }], npcs: [{ name: '', role: '', look: '', traits: '', relation: '', lines: [] }] };
  assert.ok(isEmptyCard(blank), 'blank rows added in the editor do not make a card');
  assert.ok(!isEmptyCard({ ...emptyCard(), base: '温柔' }));
});

test('cleanCard trims text and drops rows that carry nothing', () => {
  const card = cleanCard({ ...emptyCard(), main: [' 娇 ', ''], derivations: [{ trait: ' 娇 ', text: ' 很好哄 ' }, { trait: '娇', text: '' }], lines: ['  嗨～ ', ''],
    phases: [{ name: '', fromDays: 3.7, main: [], accents: [], derivations: [], notes: [] }, { name: '熟络', fromDays: -2, main: [], accents: [], derivations: [], notes: [] }] });
  assert.deepEqual(card.main, ['娇']);
  assert.deepEqual(card.derivations, [{ trait: '娇', text: '很好哄' }]);
  assert.deepEqual(card.lines, ['嗨～']);
  assert.deepEqual(card.phases.map(p => [p.name, p.fromDays]), [['熟络', 0]]);
});

test('completeCard fills a partial (AI-drafted or imported) card so every field can be bound', () => {
  const card = completeCard({ base: '责任感', main: ['嘴硬'], phases: [{ name: '后来' } as never] });
  assert.equal(card.base, '责任感'); assert.deepEqual(card.accents, []); assert.deepEqual(card.facets, []);
  assert.deepEqual(card.phases[0], { name: '后来', fromDays: 0, main: [], accents: [], derivations: [], notes: [] });
});
