// Custom pixel pets are plain JSON files in <userData>/pets, so players (or an AI
// following the galagent-pixel-pet skill) can drop new characters in without the app.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parsePixelPet, type PixelPetSpec } from '../shared/pixel-sprite';
import { builtinPixelPets } from '../shared/pixel-pets';
import type { PetCatalogEntry } from '../shared/contracts';

const MAX_CUSTOM = 100;
export class PetLibrary {
  private cache = new Map<string, { spec: PixelPetSpec; file: string; mtime: number }>();
  private signature = '';
  revision = 0;
  readonly folder: string;
  constructor(dataDir: string) { this.folder = join(dataDir, 'pets'); }
  /** Re-reads the folder when file names or modification times changed. Broken files are skipped and listed. */
  scan(): string[] {
    const problems: string[] = [];
    let entries: { file: string; mtime: number }[] = [];
    try { entries = readdirSync(this.folder).filter(name => name.toLowerCase().endsWith('.json')).slice(0, MAX_CUSTOM * 2).map(name => { const file = join(this.folder, name); return { file, mtime: statSync(file).mtimeMs }; }); }
    catch { entries = []; }
    const signature = JSON.stringify(entries);
    if (signature === this.signature) return problems;
    this.signature = signature;
    const next = new Map<string, { spec: PixelPetSpec; file: string; mtime: number }>();
    for (const entry of entries) {
      try {
        const result = parsePixelPet(readFileSync(entry.file, 'utf8'));
        if (!result.ok) { problems.push(`${entry.file}: ${result.errors.slice(0, 3).join('；')}`); continue; }
        if (builtinPixelPets.some(p => p.id === result.spec.id) || next.has(result.spec.id)) { problems.push(`${entry.file}: ID ${result.spec.id} 已被占用`); continue; }
        if (next.size < MAX_CUSTOM) next.set(result.spec.id, { spec: result.spec, file: entry.file, mtime: entry.mtime });
      } catch (error) { problems.push(`${entry.file}: ${error instanceof Error ? error.message : '读取失败'}`); }
    }
    this.cache = next; this.revision++;
    return problems;
  }
  catalog(): PetCatalogEntry[] {
    return [
      ...builtinPixelPets.map(p => ({ id: p.id, name: p.name, description: p.description, builtin: true })),
      ...[...this.cache.values()].map(({ spec }) => ({ id: spec.id, name: spec.name, description: spec.description, builtin: false })),
    ];
  }
  has(id: string) { return builtinPixelPets.some(p => p.id === id) || this.cache.has(id); }
  get(id: string): PixelPetSpec | undefined { return builtinPixelPets.find(p => p.id === id) || this.cache.get(id)?.spec; }
  import(text: string): PixelPetSpec {
    const result = parsePixelPet(text);
    if (!result.ok) throw new Error('小人文件未通过校验：' + result.errors.slice(0, 4).join('；'));
    if (builtinPixelPets.some(p => p.id === result.spec.id)) throw new Error('这个 ID 属于内置小人，请换一个 id');
    if (!this.cache.has(result.spec.id) && this.cache.size >= MAX_CUSTOM) throw new Error(`最多保存 ${MAX_CUSTOM} 个自定义小人`);
    mkdirSync(this.folder, { recursive: true });
    // Re-importing an existing id overwrites the file it came from, whatever that file is called.
    const file = this.cache.get(result.spec.id)?.file || join(this.folder, `${result.spec.id}.json`), temporary = file + '.new';
    writeFileSync(temporary, JSON.stringify(result.spec, null, 2));
    renameSync(temporary, file);
    this.signature = ''; this.scan();
    return result.spec;
  }
  delete(id: string) {
    const entry = this.cache.get(id);
    if (!entry) throw new Error(builtinPixelPets.some(p => p.id === id) ? '内置小人不能删除' : '小人不存在');
    if (existsSync(entry.file)) unlinkSync(entry.file);
    this.signature = ''; this.scan();
  }
}
