import type { AppSnapshot } from '../shared/contracts';
import type { PixelPetSpec } from '../shared/pixel-sprite';
import { builtinPixelPets } from '../shared/pixel-pets';
import { command } from './ui';

const custom = new Map<string, { revision: number; spec: PixelPetSpec }>();
/** Which sprite to wear: an explicit choice, else the active card's avatar, else the first built-in. */
export function wantedPet(snapshot: AppSnapshot): string {
  const catalog = snapshot.pets?.catalog || [];
  const known = (id?: string) => !!id && (builtinPixelPets.some(p => p.id === id) || catalog.some(p => p.id === id));
  if (known(snapshot.settings.petId)) return snapshot.settings.petId!;
  if (known(snapshot.persona?.active.avatar)) return snapshot.persona!.active.avatar;
  return builtinPixelPets[0].id;
}
export async function loadPet(id: string, revision = 0): Promise<PixelPetSpec> {
  const builtin = builtinPixelPets.find(p => p.id === id);
  if (builtin) return builtin;
  const cached = custom.get(id);
  if (cached && cached.revision === revision) return cached.spec;
  const result = await command({ type: 'pet.get', id }, true);
  if (result.ok && result.data) { const spec = result.data as PixelPetSpec; custom.set(id, { revision, spec }); return spec; }
  return builtinPixelPets[0];
}
