import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { readFile, writeFile, mkdir, rename, readdir, unlink } from 'node:fs/promises';
import type { HostSession } from './tool-host';

export type CheckpointManifest = {
  runId: string;
  sessionId: string;
  label: string;
  cwd: string;
  createdAt: number;
  undoneAt?: number;
  files: Record<string, { existed: boolean; blob: string | null; after?: string | null }>;
};
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const changed = (entry: CheckpointManifest['files'][string]) =>
  entry.after !== undefined && (entry.existed && !entry.blob || entry.after !== entry.blob);

async function saveManifest(file: string, manifest: CheckpointManifest) {
  const tmp = file + '.' + randomUUID();
  try {
    await writeFile(tmp, JSON.stringify(manifest));
    await rename(tmp, file);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

export class FileCheckpoints {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private base: () => string | undefined,
    private clock: () => number,
    private canRestore: (file: string, cwd: string) => boolean,
    private forgetReads: (files: string[]) => void,
  ) {}

  // Only local checkpointed writes and undo queue here; shells and model requests stay independent.
  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.base()) return operation();
    const result = this.pending.then(operation);
    this.pending = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  /** First touch of a file in a run stores its original bytes (≤5 MiB) so the whole run can be undone. */
  async checkpoint(session: HostSession, file: string, before: Buffer | undefined) {
    const base = this.base(),
      root = session;
    if (!base || !root.runId) return;
    const dir = path.join(base, root.id, root.runId),
      manifestFile = path.join(dir, 'manifest.json');
    await mkdir(dir, { recursive: true });
    const existing = await readFile(manifestFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    const manifest: CheckpointManifest = existing === undefined ? {
      runId: root.runId, sessionId: root.id, label: root.runLabel || '', cwd: root.cwd,
      createdAt: this.clock(), files: {},
    } : JSON.parse(existing);
    if (manifest.undoneAt !== undefined) throw new Error('此任务已撤销');
    if (!manifest.files[file]) {
      if (before && before.length > 5 * 1024 * 1024) manifest.files[file] = { existed: true, blob: null };
      else if (before) {
        const blob = digest(before);
        await writeFile(path.join(dir, blob), before);
        manifest.files[file] = { existed: true, blob };
      } else manifest.files[file] = { existed: false, blob: null };
    }
    await saveManifest(manifestFile, manifest);
  }
  async recordAfter(session: HostSession, file: string, after: Buffer | undefined) {
    await this.recordDigests(session, new Map([[file, after ? digest(after) : null]]));
  }
  /** Record all expected writes in one manifest update, retaining the prior state for rollback. */
  async recordDigests(session: HostSession, writes: ReadonlyMap<string, string | null | undefined>) {
    const base = this.base(),
      root = session;
    const previous = new Map<string, string | null | undefined>();
    if (!base || !root.runId || !writes.size) return previous;
    const manifestFile = path.join(base, root.id, root.runId, 'manifest.json');
    const manifest: CheckpointManifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    for (const [file, after] of writes) {
      const entry = manifest.files[file];
      if (!entry) throw new Error('File checkpoint missing');
      previous.set(file, entry.after);
      entry.after = after;
    }
    await saveManifest(manifestFile, manifest);
    return previous;
  }
  /** The most recent run with file changes that has not been undone. */
  async lastRun(): Promise<CheckpointManifest | undefined> {
    const base = this.base();
    if (!base) return undefined;
    let latest: CheckpointManifest | undefined;
    for (const sid of await readdir(base).catch(() => [] as string[]))
      for (const rid of await readdir(path.join(base, sid)).catch(() => [] as string[])) {
        const m: CheckpointManifest | undefined = await readFile(
          path.join(base, sid, rid, 'manifest.json'),
          'utf8',
        ).then(JSON.parse, () => undefined);
        if (m && !m.undoneAt && Object.values(m.files).some(changed) && (!latest || m.createdAt > latest.createdAt))
          latest = m;
      }
    return latest;
  }
  /** Restores every file the run changed, unless it changed again afterwards (then it is left alone and reported). */
  async undoRun(
    runId?: string,
  ): Promise<{ label: string; restored: string[]; conflicts: string[]; skipped: string[] }> {
    const base = this.base();
    if (!base) throw new Error('Checkpoints are unavailable');
    const manifest = runId ? await this.findRun(runId) : await this.lastRun();
    if (!manifest) throw new Error('没有可撤销的文件改动');
    if (manifest.undoneAt) throw new Error('这个任务的改动已经撤销过了');
    const dir = path.join(base, manifest.sessionId, manifest.runId),
      restored: string[] = [],
      conflicts: string[] = [],
      skipped: string[] = [];
    for (const [file, entry] of Object.entries(manifest.files)) {
      if (!changed(entry)) continue;
      try {
        if (!this.canRestore(file, manifest.cwd)) {
          skipped.push(file);
          continue;
        }
        const current = await readFile(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
        if (entry.after === undefined || (current ? digest(current) : null) !== entry.after) {
          conflicts.push(file);
          continue;
        }
        if (!entry.existed) {
          if (!this.canRestore(file, manifest.cwd)) { skipped.push(file); continue; }
          if (current) await unlink(file);
          restored.push(file);
          continue;
        }
        if (!entry.blob) {
          skipped.push(file);
          continue;
        }
        const original = await readFile(path.join(dir, entry.blob));
        if (!this.canRestore(file, manifest.cwd)) { skipped.push(file); continue; }
        await mkdir(path.dirname(file), { recursive: true });
        const temporary = file + '.galagent-' + randomUUID();
        await writeFile(temporary, original);
        await rename(temporary, file);
        restored.push(file);
      } catch {
        skipped.push(file);
      }
    }
    manifest.undoneAt = this.clock();
    await saveManifest(path.join(dir, 'manifest.json'), manifest);
    this.forgetReads(restored);
    return { label: manifest.label, restored, conflicts, skipped };
  }
  private async findRun(runId: string) {
    const base = this.base();
    if (!base || !runId || runId === '.' || runId === '..' || /[\\/:]/.test(runId)) return undefined;
    for (const sid of await readdir(base).catch(() => [] as string[])) {
      const m = await readFile(path.join(base, sid, runId, 'manifest.json'), 'utf8').then(
        JSON.parse,
        () => undefined,
      );
      if (m) return m as CheckpointManifest;
    }
    return undefined;
  }
  /** Files changed so far in a run (for the task summary). */
  async runChanges(session: HostSession): Promise<string[]> {
    const base = this.base(),
      root = session;
    if (!base || !root.runId) return [];
    const m: CheckpointManifest | undefined = await readFile(
      path.join(base, root.id, root.runId, 'manifest.json'),
      'utf8',
    ).then(JSON.parse, () => undefined);
    return m ? Object.entries(m.files).filter(([, entry]) => changed(entry)).map(([file]) => file) : [];
  }
}
