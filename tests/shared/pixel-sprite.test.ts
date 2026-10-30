import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PIXEL_ACTIONS, PIXEL_EYE_STATES, PIXEL_EXPRESSIONS, PIXEL_MOUTHS, PIXEL_PET_FORMAT,
  composeFrame, composeGrid, opaqueBounds, parsePixelPet, resolveEyes, validatePixelPet,
  type PixelPetSpec,
} from '../../runtime/shared/pixel-sprite';
import { builtinPixelPets, DEFAULT_PIXEL_PET_ID, findBuiltinPixelPet } from '../../runtime/shared/pixel-pets';

const root = join(import.meta.dirname, '../..');
const template = JSON.parse(readFileSync(join(root, 'skills/galagent-pixel-pet/template.json'), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function minimal(): Record<string, unknown> {
  return {
    format: PIXEL_PET_FORMAT, id: 'test-pet', name: '测试', description: '测试用小人',
    size: [16, 16], palette: { o: '#000000', f: '#ffffff', k: '#222222' },
    base: Array.from({ length: 16 }, (_, y) => (y >= 4 && y <= 13 ? '...' + 'f'.repeat(10) + '...' : '.'.repeat(16))),
    anchors: { eyes: [5, 7], mouth: [7, 10] },
    eyes: { neutral: ['k....k'] },
    mouth: { closed: ['kk'], open: ['kk', 'kk'] },
  };
}

test('ships at least 12 built-in pets with unique ids, all passing the validator', () => {
  assert.ok(builtinPixelPets.length >= 12, `only ${builtinPixelPets.length} built-ins`);
  const ids = builtinPixelPets.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
  for (const pet of builtinPixelPets) {
    const result = validatePixelPet(pet);
    assert.ok(result.ok, `${pet.id}: ${result.ok ? '' : result.errors.join('; ')}`);
    const text = readFileSync(join(root, 'runtime/shared/pixel-pets', `${pet.id}.json`), 'utf8');
    assert.ok(parsePixelPet(text).ok, `${pet.id}.json should parse`);
    assert.ok(/[一-鿿]/.test(pet.name), `${pet.id} should have a Chinese name`);
  }
  for (const id of ['sunny-girl', 'scholar-boy', 'mochi-cat', 'robo-unit', 'fox-kit', 'cloud-sprite', 'tiny-dino']) assert.ok(findBuiltinPixelPet(id), `missing required built-in ${id}`);
  assert.equal(builtinPixelPets[0].id, DEFAULT_PIXEL_PET_ID);
});

test('built-ins provide walk frames or a motion style, and distinct expressions', () => {
  for (const pet of builtinPixelPets) {
    assert.ok((pet.legs?.length ?? 0) >= 2 || pet.motion?.style === 'hop' || pet.motion?.style === 'float', `${pet.id} cannot walk`);
    const frames = PIXEL_EYE_STATES.map(expression => composeGrid(pet, { expression }).join('\n'));
    assert.ok(new Set(frames).size >= 8, `${pet.id} expressions are not distinguishable`);
    assert.notEqual(composeGrid(pet, { mouth: 'open' }).join(), composeGrid(pet, { mouth: 'closed' }).join(), `${pet.id} mouth does not open`);
  }
});

test('the skill template and the inline SKILL.md example are valid pets', () => {
  const result = validatePixelPet(template);
  assert.ok(result.ok, result.ok ? '' : result.errors.join('; '));
  const skill = readFileSync(join(root, 'skills/galagent-pixel-pet/SKILL.md'), 'utf8');
  const example = skill.match(/```json\r?\n([\s\S]*?)\r?\n```/)?.[1];
  assert.ok(example, 'SKILL.md should contain a json example');
  const parsed = parsePixelPet(example);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
});

test('composeFrame is deterministic and sized to the spec', () => {
  for (const pet of builtinPixelPets) {
    const [w, h] = pet.size;
    const state = { expression: 'flustered' as const, mouth: 'open' as const, legFrame: 1, blush: true, extrasPhase: 0.5, look: [1, -1] as [number, number] };
    const a = composeFrame(pet, state), b = composeFrame(pet, state);
    assert.equal(a.length, w * h * 4);
    assert.deepEqual(a, b);
    const grid = composeGrid(pet, state);
    assert.equal(grid.length, h);
    for (const row of grid) assert.equal([...row].length, w);
    assert.ok(a.some((v, i) => i % 4 === 3 && v > 0), `${pet.id} renders nothing`);
  }
});

test('missing eye states are derived: blink/sleep closed lines, pleased arcs, dizzy crosses, others neutral', () => {
  const spec = validatePixelPet(minimal());
  assert.ok(spec.ok);
  const pet = spec.spec;
  assert.deepEqual(resolveEyes(pet, 'curious'), pet.eyes.neutral);
  assert.deepEqual(resolveEyes(pet, 'blink'), ['k....k']);
  const tall = clone(minimal()) as unknown as PixelPetSpec;
  tall.eyes = { neutral: ['kk..kk', 'kk..kk', 'kk..kk'] };
  assert.deepEqual(resolveEyes(tall, 'blink'), ['......', 'kk..kk', '......']);
  assert.deepEqual(resolveEyes(tall, 'dizzy'), ['kk..kk', 'kk..kk', '......']);
  const wide = clone(minimal()) as unknown as PixelPetSpec;
  wide.eyes = { neutral: ['kkk.kkk', 'kkk.kkk', 'kkk.kkk'] };
  assert.deepEqual(resolveEyes(wide, 'blink'), ['k.k.k.k', '.k...k.', '.......']);
  assert.deepEqual(resolveEyes(wide, 'pleased'), ['.......', '.k...k.', 'k.k.k.k']);
  for (const state of PIXEL_EYE_STATES) assert.equal(resolveEyes(wide, state).length, 3);
});

test('overlays, erase, raw frames and extras compose in order', () => {
  const raw = minimal();
  raw.legs = [['...ff....ff.....'], ['....ff..ff......']];
  raw.anchors = { ...(raw.anchors as object), feet: [0, 14] };
  raw.extras = [{ id: 'hat', layer: 'front', at: [6, 2], frames: [['kkkk'], ['_kk_']] }];
  raw.frames = { sleep: [Array.from({ length: 16 }, () => 'k'.repeat(16))] };
  const result = validatePixelPet(raw);
  assert.ok(result.ok, result.ok ? '' : result.errors.join('; '));
  const pet = result.spec;
  assert.equal(composeGrid(pet, { legFrame: 0 })[14], '...ff....ff.....');
  assert.equal(composeGrid(pet, { legFrame: 3 })[14], '....ff..ff......');
  assert.equal(composeGrid(pet, { extrasPhase: 0 })[2].slice(6, 10), 'kkkk');
  assert.equal(composeGrid(pet, { extrasPhase: 0.6 })[2].slice(6, 10), '.kk.');
  assert.equal(composeGrid(pet, { mouth: 'open' })[11].slice(7, 9), 'kk');
  assert.equal(composeGrid(pet, { animation: 'sleep' })[0], 'k'.repeat(16));
  assert.equal(composeGrid(pet, { animation: 'celebrate' })[2], '......kkkk......', 'animations without raw frames fall back to procedural composition');
  assert.deepEqual(composeGrid(pet, { look: [1, 0] })[7].indexOf('k'), 6);
  const bounds = opaqueBounds(pet);
  assert.ok(bounds.width > 0 && bounds.height > 0);
});

test('validator rejects bad input with Chinese, path-hinted errors', () => {
  const cases: [string, (raw: Record<string, any>) => void, RegExp][] = [
    ['format', r => { r.format = 'other@1'; }, /^format：/],
    ['id', r => { r.id = 'Bad ID'; }, /^id：/],
    ['size', r => { r.size = [8, 100]; }, /^size：/],
    ['row width', r => { r.base[3] = 'f'; }, /^base\[3\]：.*行宽/],
    ['row count', r => { r.base = r.base.slice(1); }, /^base：.*行数/],
    ['unknown char', r => { r.base[0] = 'Z' + r.base[0].slice(1); }, /^base\[0\]\[0\]：字符 "Z" 不在调色板中/],
    ['bad color', r => { r.palette.f = 'white'; }, /^palette\["f"\]：/],
    ['palette key', r => { r.palette['..'] = '#ffffff'; }, /palette/],
    ['too many colors', r => { for (let i = 0; i < 40; i++) r.palette[String.fromCharCode(65 + i)] = '#000000'; }, /最多 32 种/],
    ['overlay bounds', r => { r.anchors.eyes = [14, 7]; }, /^eyes\.neutral：.*超出画布/],
    ['missing neutral', r => { r.eyes = { blink: ['kk'] }; }, /^eyes\.neutral：/],
    ['unknown eye', r => { r.eyes.wink = ['k']; }, /^eyes\.wink：未知/],
    ['missing open mouth', r => { delete r.mouth.open; }, /^mouth\.open：/],
    ['erase in base', r => { r.base[0] = '_' + r.base[0].slice(1); }, /擦除/],
    ['legs one frame', r => { r.legs = [['ff']]; }, /^legs：/],
    ['unknown field', r => { r.script = 'alert(1)'; }, /^script：未知字段/],
    ['blush without anchor', r => { r.blush = ['kk']; }, /^anchors\.blush：/],
    ['extra duplicate', r => { r.extras = [{ id: 'a', at: [0, 0], frames: [['k']] }, { id: 'a', at: [0, 0], frames: [['k']] }]; }, /重复/],
    ['raw frame unknown anim', r => { r.frames = { fly: [r.base] }; }, /^frames\.fly：未知动画/],
    ['line color', r => { r.lineColor = 'q'; }, /^lineColor：/],
  ];
  for (const [label, mutate, pattern] of cases) {
    const raw = clone(minimal()) as Record<string, any>;
    mutate(raw);
    const result = validatePixelPet(raw);
    assert.equal(result.ok, false, `${label} should be rejected`);
    if (!result.ok) assert.ok(result.errors.some(e => pattern.test(e)), `${label}: ${result.errors.join(' | ')}`);
  }
  assert.equal(validatePixelPet(null).ok, false);
  assert.equal(validatePixelPet([]).ok, false);
  const notJson = parsePixelPet('{oops');
  assert.ok(!notJson.ok && /JSON 语法错误/.test(notJson.errors[0]));
  const huge = parsePixelPet(JSON.stringify({ ...minimal(), description: 'x'.repeat(300 * 1024) }));
  assert.ok(!huge.ok && /文件过大/.test(huge.errors[0]));
  assert.ok(parsePixelPet('﻿' + JSON.stringify(minimal())).ok, 'BOM tolerated');
});

test('exported vocabularies cover the renderer contract', () => {
  assert.deepEqual([...PIXEL_EXPRESSIONS], ['neutral', 'curious', 'pleased', 'flustered', 'annoyed', 'softened', 'blink']);
  for (const s of ['sleep', 'dizzy', 'love']) assert.ok((PIXEL_EYE_STATES as readonly string[]).includes(s));
  for (const a of ['idle', 'nod', 'sway', 'peek', 'sulk', 'celebrate', 'wave', 'sparkle', 'doodle', 'run', 'sleep', 'think', 'dizzy', 'love']) assert.ok((PIXEL_ACTIONS as readonly string[]).includes(a));
  assert.deepEqual([...PIXEL_MOUTHS], ['closed', 'open', 'smile', 'pout']);
});
