import assert from 'node:assert/strict';
import test from 'node:test';
import { PET_FOOTPRINT, clampPet, cornerPosition, roamRange, validFootprint, type Footprint } from '../../runtime/shared/pet-geometry';

const area = { x: 0, y: 0, width: 1920, height: 1040 };
/** Window positions are whole pixels, so an edge can sit within 1 px of the intended line. */
const near = (a: number, b: number) => Math.abs(a - b) <= 1;
const win = { width: 320, height: 440 };
const pet: Footprint = { left: 0.25, top: 0.58, right: 0.75, bottom: 0.96 };

test('the visible pet can reach the top of the screen while the empty canvas hangs off', () => {
  // Dragging straight up: the window top goes negative, the sprite head stops at the work area top.
  const moved = clampPet({ ...win, x: 800, y: -500 }, pet, area);
  assert.ok(near(moved.y, -pet.top * win.height));
  assert.ok(near(moved.y + pet.top * moved.height, 0));
  assert.equal(moved.x, 800);
});

test('the feet can rest on the bottom edge and the body can touch either side', () => {
  const down = clampPet({ ...win, x: 800, y: 5000 }, pet, area);
  assert.ok(near(down.y + pet.bottom * down.height, area.height));
  const left = clampPet({ ...win, x: -500, y: 300 }, pet, area);
  assert.ok(near(left.x + pet.left * left.width, area.x));
  const right = clampPet({ ...win, x: 5000, y: 300 }, pet, area);
  assert.ok(near(right.x + pet.right * right.width, area.x + area.width));
});

test('a window that fits is left alone, and the window size never exceeds the desk', () => {
  const inside = { ...win, x: 400, y: 200 };
  assert.deepEqual(clampPet(inside, pet, area), inside);
  const huge = clampPet({ x: 0, y: 0, width: 4000, height: 3000 }, pet, area);
  assert.equal(huge.width, area.width);
  assert.equal(huge.height, area.height);
});

test('a second monitor to the left keeps its own origin', () => {
  const left = { x: -1280, y: 0, width: 1280, height: 1040 };
  const placed = clampPet({ ...win, x: -1280 + 40, y: -400 }, pet, left);
  assert.equal(placed.x, -1280 + 40);
  assert.ok(near(placed.y + pet.top * placed.height, left.y));
});

test('roaming turns around with the sprite, not the canvas, inside the margin', () => {
  const range = roamRange(area, pet, win.width);
  assert.ok(near(range.min + pet.left * win.width, 12));
  assert.ok(near(range.max + pet.right * win.width, area.width - 12));
});

test('the resting corner puts the sprite bottom-right, 30 px from the edge', () => {
  const spot = cornerPosition(area, pet, win.width, win.height, 30);
  assert.ok(near(spot.x + pet.right * win.width, area.width - 30));
  assert.ok(near(spot.y + pet.bottom * win.height, area.height - 30));
  assert.deepEqual(clampPet(spot, pet, area), spot);
});

test('a reported footprint is accepted only when it is a sane fraction box', () => {
  assert.deepEqual(validFootprint({ left: 0.2, top: 0.4, right: 0.8, bottom: 0.99 }), { left: 0.2, top: 0.4, right: 0.8, bottom: 0.99 });
  for (const bad of [undefined, null, {}, { left: 0, top: 0, right: 1 }, { left: 0.5, top: 0, right: 0.4, bottom: 1 }, { left: -0.1, top: 0, right: 0.5, bottom: 1 }, { left: 0, top: 0, right: 1.2, bottom: 1 }, { left: 0, top: 0, right: 0.02, bottom: 1 }, { left: '0', top: 0, right: 1, bottom: 1 }, { left: NaN, top: 0, right: 1, bottom: 1 }]) {
    assert.equal(validFootprint(bad), undefined, JSON.stringify(bad));
  }
});

test('the default footprint describes a sprite in the lower half of the window', () => {
  assert.ok(PET_FOOTPRINT.top > 0.4 && PET_FOOTPRINT.bottom > 0.9);
  assert.ok(Math.abs((PET_FOOTPRINT.left + PET_FOOTPRINT.right) / 2 - 0.5) < 0.02);
});
