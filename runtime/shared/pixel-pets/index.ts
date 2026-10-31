/** 内置像素小人（由 scripts/pixel-pet/generate-builtins.mjs 生成，原创图案）。 */
import type { PixelPetSpec } from '../pixel-sprite';
import sunnyGirl from './sunny-girl.json';
import scholarBoy from './scholar-boy.json';
import peachTwintail from './peach-twintail.json';
import starWitch from './star-witch.json';
import kimiStar from './kimi-star.json';
import coderHoodie from './coder-hoodie.json';
import astroKid from './astro-kid.json';
import chefSpoon from './chef-spoon.json';
import sleuthGirl from './sleuth-girl.json';
import hanfuGirl from './hanfu-girl.json';
import grandpaFu from './grandpa-fu.json';
import sportyKid from './sporty-kid.json';
import mochiCat from './mochi-cat.json';
import foxKit from './fox-kit.json';
import puffBunny from './puff-bunny.json';
import tinyDino from './tiny-dino.json';
import roboUnit from './robo-unit.json';
import cloudSprite from './cloud-sprite.json';
import jellySlime from './jelly-slime.json';
import booGhost from './boo-ghost.json';
import pebblePenguin from './pebble-penguin.json';
import shroomSprout from './shroom-sprout.json';

const raw: unknown[] = [
  sunnyGirl,
  scholarBoy,
  peachTwintail,
  starWitch,
  kimiStar,
  coderHoodie,
  astroKid,
  chefSpoon,
  sleuthGirl,
  hanfuGirl,
  grandpaFu,
  sportyKid,
  mochiCat,
  foxKit,
  puffBunny,
  tinyDino,
  roboUnit,
  cloudSprite,
  jellySlime,
  booGhost,
  pebblePenguin,
  shroomSprout,
];

/** 按展示顺序排列；默认小人为第一个。全部内置小人都由 tests/shared/pixel-sprite.test.ts 校验。 */
export const builtinPixelPets = raw as PixelPetSpec[];

export const DEFAULT_PIXEL_PET_ID = 'sunny-girl';

export function findBuiltinPixelPet(id: string): PixelPetSpec | undefined {
  return builtinPixelPets.find(pet => pet.id === id);
}
