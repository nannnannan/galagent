// Purely decorative overlays: confetti, the achievement toast and seasonal ambient particles.
// Everything here is pointer-events: none and never takes part in the pet's hit-testing.
import type { BondView } from '../shared/contracts';
import type { Season } from './fun';
import { el } from './ui';

const reduced = () => document.body.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const COLORS = ['#7c5cff', '#ff8fb1', '#ffd75e', '#5fd4a8', '#6fb8ff', '#ff9f5a'];

/** A short confetti burst from a point (client coordinates; defaults to the top centre). */
export function confetti(origin?: { x: number; y: number }, count = 36, spread = 1) {
  if (reduced() || document.hidden) return;
  const box = el('div', 'confetti'); box.setAttribute('aria-hidden', 'true');
  const x = origin?.x ?? innerWidth / 2, y = origin?.y ?? innerHeight * 0.18;
  for (let i = 0; i < count; i++) {
    const piece = el('i');
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1, power = (90 + Math.random() * 170) * spread;
    piece.style.cssText = `left:${x}px;top:${y}px;--x:${Math.round(Math.cos(ang) * power)}px;--y:${Math.round(Math.sin(ang) * power)}px;--r:${Math.round((Math.random() - 0.5) * 900)}deg;--c:${COLORS[i % COLORS.length]};--d:${Math.round(Math.random() * 120)}ms;--w:${4 + Math.round(Math.random() * 4)}px`;
    if (i % 3 === 0) piece.className = 'round';
    box.append(piece);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 1900);
}

type Achievement = BondView['achievements'][number];
const queue: Achievement[] = [];
let showing = false;
/** Notebook-style toast: "🏆 解锁成就：xxx", one at a time, with confetti. */
export function trophyToast(item: Achievement) {
  queue.push(item);
  if (!showing) next();
}
function next() {
  const item = queue.shift();
  if (!item) { showing = false; return; }
  showing = true;
  const box = el('div', 'trophy-toast'); box.setAttribute('role', 'status');
  const text = el('div', 'trophy-text'); text.append(el('small', '', '🏆 解锁成就'), el('strong', '', item.title), el('span', '', item.description));
  box.append(el('span', 'trophy-icon', item.icon || '🏆'), text);
  document.body.append(box);
  requestAnimationFrame(() => box.classList.add('visible'));
  const rect = () => box.getBoundingClientRect();
  setTimeout(() => { const r = rect(); confetti({ x: r.left + 34, y: r.top + r.height / 2 }, 40); }, 180);
  setTimeout(() => { box.classList.remove('visible'); setTimeout(() => { box.remove(); next(); }, 420); }, 4200);
}

type Mote = { x: number; y: number; vx: number; vy: number; phase: number; size: number; color: string; spin: number };
const SPECS: Record<Exclude<Season, 'none'>, { count: number; colors: string[] }> = {
  snow: { count: 14, colors: ['#ffffff', '#eef4ff', '#dfe9ff'] },
  petals: { count: 9, colors: ['#ffc4d6', '#ffb0c8', '#ffe1ea'] },
  leaves: { count: 7, colors: ['#e8a33d', '#d9692b', '#c9a14a', '#b8552a'] },
  fireflies: { count: 8, colors: ['#f4ff9e', '#e2ff7a'] },
};
/** Very sparse seasonal particles behind the pet; drawn as chunky pixels at ≤30 fps. */
export class Ambient {
  readonly canvas = el('canvas', 'ambient');
  private ctx = this.canvas.getContext('2d');
  private motes: Mote[] = [];
  private kind: Season = 'none';
  private raf = 0; private last = 0;
  constructor(host: HTMLElement) { this.canvas.setAttribute('aria-hidden', 'true'); host.prepend(this.canvas); }
  set(kind: Season, active: boolean) {
    const run = active && kind !== 'none';
    if (kind !== this.kind) { this.kind = kind; this.motes = []; }
    this.canvas.dataset.season = kind;
    if (run && !this.raf) { this.last = 0; this.raf = requestAnimationFrame(this.tick); }
    if (!run && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    if (!run) this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.classList.toggle('on', run);
  }
  private spawn(w: number, h: number, anywhere: boolean): Mote {
    const spec = SPECS[this.kind as Exclude<Season, 'none'>], fire = this.kind === 'fireflies';
    const fall = this.kind === 'snow' ? 14 + Math.random() * 14 : this.kind === 'leaves' ? 16 + Math.random() * 10 : 12 + Math.random() * 10;
    return {
      x: Math.random() * w, y: anywhere || fire ? Math.random() * h : -8 - Math.random() * 40,
      vx: fire ? (Math.random() - 0.5) * 10 : this.kind === 'snow' ? (Math.random() - 0.5) * 4 : 6 + Math.random() * 8,
      vy: fire ? (Math.random() - 0.5) * 8 : fall, phase: Math.random() * Math.PI * 2, size: this.kind === 'snow' ? (Math.random() < 0.3 ? 3 : 2) : 2,
      color: spec.colors[Math.floor(Math.random() * spec.colors.length)], spin: 0.6 + Math.random() * 1.4,
    };
  }
  private tick = (ts: number) => {
    this.raf = requestAnimationFrame(this.tick);
    if (this.last && ts - this.last < 32) return;
    const dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0.033; this.last = ts;
    const ctx = this.ctx; if (!ctx || this.kind === 'none') return;
    const dpr = Math.min(2, devicePixelRatio || 1), w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * dpr)) { this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); }
    const count = SPECS[this.kind].count;
    while (this.motes.length < count) this.motes.push(this.spawn(w, h, true)); // first fill is spread out, later ones enter from the top
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const fire = this.kind === 'fireflies';
    this.motes = this.motes.map(m => {
      m.phase += dt * m.spin;
      if (fire) { m.vx += (Math.random() - 0.5) * 6 * dt; m.vy += (Math.random() - 0.5) * 6 * dt; m.vx = Math.max(-8, Math.min(8, m.vx)); m.vy = Math.max(-6, Math.min(6, m.vy)); }
      m.x += (m.vx + (fire ? 0 : Math.sin(m.phase) * (this.kind === 'snow' ? 6 : 12))) * dt; m.y += m.vy * dt;
      const gone = fire ? m.x < -10 || m.x > w + 10 || m.y < -10 || m.y > h + 10 : m.y > h + 8 || m.x > w + 12;
      return gone ? this.spawn(w, h, false) : m;
    });
    for (const m of this.motes) {
      const p = m.size, x = Math.round(m.x), y = Math.round(m.y);
      ctx.fillStyle = m.color;
      if (fire) {
        const glow = 0.35 + 0.65 * Math.max(0, Math.sin(m.phase * 2));
        ctx.globalAlpha = glow * 0.22; ctx.fillRect(x - 3, y - 3, 9, 9);
        ctx.globalAlpha = glow * 0.45; ctx.fillRect(x - 1, y - 1, 5, 5);
        ctx.globalAlpha = glow; ctx.fillRect(x, y, 3, 3);
      } else if (this.kind === 'snow') { ctx.globalAlpha = 0.85; ctx.fillRect(x, y, p, p); }
      else {
        // Petals and leaves flip as they tumble: a 3×2 shape that narrows to 1 px wide edge-on.
        const flip = Math.abs(Math.cos(m.phase)); ctx.globalAlpha = 0.9;
        const width = flip > 0.5 ? 3 : flip > 0.2 ? 2 : 1;
        ctx.fillRect(x, y, width * 1.5, 2); if (this.kind === 'leaves' && width > 1) ctx.fillRect(x + 1, y + 2, 1.5, 1);
      }
    }
    ctx.globalAlpha = 1;
  };
  destroy() { this.set('none', false); this.canvas.remove(); }
}
