import { randomUUID } from 'node:crypto';
import type { Store } from './store';
import { builtinPersonas, buildPersonaPrompt, DEFAULT_PERSONA_ID, normalizePersona, PERSONA_LIMITS, type PersonaDraft, type PersonaProfile } from '../shared/personas';

/** Owns the built-in and user-written character cards and which one is active. */
export class PersonaBook {
  constructor(private store: Store, private clock = () => Date.now()) {}
  private custom(): PersonaProfile[] {
    return this.store.all<PersonaProfile>('persona').filter(p => !this.store.dead(p.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  list(): PersonaProfile[] { return [...builtinPersonas, ...this.custom()]; }
  get(id: string): PersonaProfile | undefined { return builtinPersonas.find(p => p.id === id) || this.custom().find(p => p.id === id); }
  activeId(): string { const id = this.store.get<string>('active-persona'); return id && this.get(id) ? id : DEFAULT_PERSONA_ID; }
  active(): PersonaProfile { return this.get(this.activeId())!; }
  select(id: string): PersonaProfile {
    const persona = this.get(id);
    if (!persona) throw new Error('角色卡不存在');
    this.store.put('state', 'active-persona', persona.id);
    return persona;
  }
  /** Built-in cards are read-only: saving one creates an editable copy. */
  save(draft: PersonaDraft, id?: string): PersonaProfile {
    const existing = id ? this.get(id) : undefined;
    if (id && !existing) throw new Error('角色卡不存在');
    const now = new Date(this.clock()).toISOString();
    const editable = existing && !existing.builtin ? existing : undefined;
    if (!editable && this.custom().length >= PERSONA_LIMITS.customCount) throw new Error(`最多保存 ${PERSONA_LIMITS.customCount} 张自定义角色卡`);
    const profile: PersonaProfile = { ...normalizePersona(draft, existing), id: editable?.id || randomUUID(), createdAt: editable?.createdAt || now, updatedAt: now };
    this.store.put('persona', profile.id, profile);
    return profile;
  }
  delete(id: string) {
    const persona = this.get(id);
    if (!persona) throw new Error('角色卡不存在');
    if (persona.builtin) throw new Error('内置角色卡不能删除，可以复制后修改');
    this.store.remove(id);
    if (this.store.get<string>('active-persona') === id) this.store.put('state', 'active-persona', DEFAULT_PERSONA_ID);
  }
  /** Archive restore: custom cards are plain data and re-validated. */
  import(items: unknown, activeId?: unknown) {
    if (!Array.isArray(items)) return;
    for (const raw of items.slice(0, PERSONA_LIMITS.customCount)) {
      if (!raw || typeof raw !== 'object' || typeof (raw as PersonaProfile).id !== 'string' || !/^[0-9a-f-]{36}$/i.test((raw as PersonaProfile).id)) continue;
      const value = raw as PersonaProfile;
      try {
        const createdAt = Number.isFinite(Date.parse(value.createdAt)) ? value.createdAt : new Date(this.clock()).toISOString();
        this.store.put('persona', value.id, { ...normalizePersona(value), id: value.id, createdAt, updatedAt: Number.isFinite(Date.parse(value.updatedAt)) ? value.updatedAt : createdAt } satisfies PersonaProfile);
      } catch { /* a broken card in an old archive must not block the rest of the restore */ }
    }
    if (typeof activeId === 'string' && this.get(activeId)) this.store.put('state', 'active-persona', activeId);
  }
  exportCustom() { return this.custom(); }
  prompt(daysTogether = 0): string { return buildPersonaPrompt(this.active(), daysTogether); }
}
