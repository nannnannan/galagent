import path from 'node:path';
import { homedir } from 'node:os';
import { realpathSync, statSync } from 'node:fs';

export function canonicalizePath(target: string, cwd = process.cwd()): string {
  let raw = target.trim();
  if (process.platform === 'win32' && /^\/[a-z](?:\/|$)/i.test(raw)) raw = raw[1] + ':' + raw.slice(2);
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) raw = path.join(homedir(), raw.slice(1));
  const abs = path.resolve(cwd, raw);
  let cur = abs;
  const suffix: string[] = [];
  while (true) {
    try {
      const real = (realpathSync.native || realpathSync)(cur);
      return path.normalize(suffix.length ? path.join(real, ...suffix.reverse()) : real);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.normalize(abs);
      suffix.push(path.basename(cur));
      cur = parent;
    }
  }
}
const normCompare = (p: string) =>
  process.platform === 'win32'
    ? p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
    : p.replace(/\/+$/, '');
const isSubOrEqual = (cand: string, rule: string) => {
  const c = normCompare(cand),
    r = normCompare(rule);
  return Boolean(r) && (c === r || c.startsWith(r + (process.platform === 'win32' ? '\\' : '/')));
};
function sharesForbiddenHardlink(resolvedFile: string, canonicalRules: string[]): boolean {
  if (!canonicalRules.length) return false;
  try {
    const st = statSync(resolvedFile, { bigint: true, throwIfNoEntry: false });
    // A bounded directory scan cannot prove where every hardlink points.
    // In guarded mode, refuse multiply-linked files instead of failing open.
    return Boolean(st?.isFile() && st.nlink > 1n);
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code !== 'ENOENT';
  }
}
export function isForbiddenPath(
  candidate: string,
  forbiddenPaths: readonly string[],
  cwd = process.cwd(),
  checkHardlinks = true,
): boolean {
  if (!forbiddenPaths.length || !candidate.trim()) return false;
  const candReal = canonicalizePath(candidate, cwd);
  const candLex = path.resolve(
    cwd,
    process.platform === 'win32' && /^\/[a-z](?:\/|$)/i.test(candidate)
      ? candidate[1] + ':' + candidate.slice(2)
      : candidate,
  );
  const canonicalRules: string[] = [];
  for (const raw of forbiddenPaths) {
    if (!raw || !raw.trim()) continue;
    const ruleReal = canonicalizePath(raw, cwd);
    const ruleLex = path.resolve(cwd, raw.trim());
    canonicalRules.push(ruleReal);
    if (isSubOrEqual(candReal, ruleReal) || isSubOrEqual(candLex, ruleLex) || isSubOrEqual(candReal, ruleLex))
      return true;
  }
  return checkHardlinks && sharesForbiddenHardlink(candReal, canonicalRules);
}
