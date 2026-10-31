import type { PixelEyeState, PixelFrameState, PixelMouth, PixelPetSpec } from '../shared/pixel-sprite';
import { composeGrid, gridToRgba, opaqueBounds } from '../shared/pixel-sprite';
import './pixel-pet.css';

/**
 * 像素小人渲染器（Canvas 2D）。
 * 帧由 composeGrid 以原生分辨率合成到离屏画布，再以最近邻放大绘制；
 * 位移 / 挤压拉伸 / 倾斜全部走弹簧，使像素锐利而动作顺滑。
 */
export type PetVisualState = {
  expression: 'neutral' | 'curious' | 'pleased' | 'flustered' | 'annoyed' | 'softened' | 'blink';
  action: string;
  revision: number;
  visible: boolean;
  reducedMotion: boolean;
  quiet: boolean;
  intensity?: number;
  busy?: boolean;
  sleeping?: boolean;
};

type Spring = { x: number; v: number };
type Pose = { x: number; y: number; rot: number; sx: number; sy: number };
type ParticleKind = 'heart' | 'sparkle' | 'z' | 'star' | 'puff' | 'scribble' | 'drop' | 'note';
type Particle = { kind: ParticleKind; x: number; y: number; vx: number; vy: number; age: number; life: number; color: string; seed: number; gravity: number };
type Fidget = { kind: 'look' | 'stretch' | 'hop' | 'tilt'; start: number; dur: number; side: number };
type Frame = { key: string; rgba: Uint8ClampedArray };

const ONE_SHOT: Record<string, number> = { nod: 0.9, sway: 2.4, peek: 1.8, sulk: 2.4, celebrate: 1.5, wave: 1.6, sparkle: 1.4, doodle: 2.8, dizzy: 2.6, love: 2.2 };
const LOOPS = new Set(['run', 'sleep', 'think']);
const BLUSHY = new Set<PixelEyeState>(['flustered', 'softened', 'love']);
const FRAME_MS = 1000 / 60;

const BITMAPS: Record<ParticleKind, string[]> = {
  heart: ['xx.xx', 'xxxxx', 'xxxxx', '.xxx.', '..x..'],
  sparkle: ['..x..', '..x..', 'xxxxx', '..x..', '..x..'],
  z: ['xxxx', '..x.', '.x..', 'xxxx'],
  star: ['.x.', 'xxx', 'x.x'],
  puff: ['.xx.', 'xxxx', 'xxxx', '.xx.'],
  scribble: ['x..x.', '.xx.x'],
  drop: ['.x.', 'xxx', '.x.'],
  note: ['.xx', '.x.', 'xx.'],
};
const SPARKLE_SMALL = ['.x.', 'xxx', '.x.'];
const DOT = ['xx', 'xx'];

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const ease = (t: number) => { t = clamp(t); return t * t * (3 - 2 * t); };
/** 进出包络：开头 a 秒淡入、结尾 b 秒淡出。 */
const envelope = (tau: number, dur: number, a = 0.18, b = 0.35) => ease(tau / a) * ease((dur - tau) / b);
const spring = (x = 0): Spring => ({ x, v: 0 });
function stepSpring(s: Spring, target: number, dt: number, k: number, d: number) {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) { s.v += (k * (target - s.x) - d * s.v) * h; s.x += s.v * h; }
}

export class PixelPet {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private sprite: HTMLCanvasElement;
  private spriteCtx: CanvasRenderingContext2D | null;
  private spec: PixelPetSpec;
  private pendingSpec?: PixelPetSpec;
  private poofAt = -10;
  private bounds: { x: number; y: number; width: number; height: number };
  private cache = new Map<string, Frame>();
  private frame?: Frame;
  private state: PetVisualState = { expression: 'neutral', action: 'idle', revision: -1, visible: true, reducedMotion: false, quiet: false };
  private action = 'idle';
  private actionAt = -10;
  private clock = 0;
  private raf = 0;
  private lastTs = 0;
  private fps = 0;
  private draws = 0;
  private running = false;
  private visible = true;
  private destroyed = false;
  // 姿态弹簧
  private px = spring(); private py = spring(); private rot = spring(); private sx = spring(1); private sy = spring(1);
  private facing = spring(1); private hold = spring(0); private dangle = spring(0);
  private faceDir: -1 | 1 = 1;
  // 眼神与表情
  private look = { x: 0, y: 0 };
  private pointer = { x: 0, y: 0, at: -10 };
  private eyes: PixelEyeState = 'neutral';
  private expressionAt = -10;
  private nextBlink = 2.4;
  private blinkUntil = -1;
  private doubleBlink = false;
  private fidget?: Fidget;
  private nextFidget = 8;
  // 互动
  private touchAt = -10;
  private dragging = false;
  private dragVx = 0;
  private dragLastDx = 0;
  private shake = 0;
  private dizzyUntil = -10;
  private mouthLevel = 0;
  private talkAt = -10;
  private talkUntil = -10;
  private roamActive = false;
  private roamDir: -1 | 0 | 1 = 0;
  private walkPhase = 0;
  private particles: Particle[] = [];
  private spawnClock = 0;
  private lastMatrix?: DOMMatrix;
  private unit = 1;
  private shown: { eyes: PixelEyeState; mouth: PixelMouth; legFrame: number; blush: boolean } = { eyes: 'neutral', mouth: 'closed', legFrame: 0, blush: false };
  private readonly media: MediaQueryList | null;
  private readonly resizeObserver?: ResizeObserver;
  private readonly onMedia = () => this.updateLoop();
  private readonly onVisibility = () => this.updateLoop();

  constructor(private host: HTMLElement, spec: PixelPetSpec) {
    this.spec = spec;
    this.bounds = opaqueBounds(spec);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pixel-pet-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.dataset.renderer = 'pixel-canvas';
    this.canvas.dataset.pet = spec.id;
    host.classList.add('pixel-pet');
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.sprite = document.createElement('canvas');
    this.spriteCtx = this.sprite.getContext('2d', { alpha: true, willReadFrequently: false });
    this.resizeSprite();
    Object.defineProperty(this.canvas, 'getPixelPetDiagnostics', { value: () => this.getDiagnostics() });
    this.media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.media?.addEventListener('change', this.onMedia);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => { if (!this.running) this.renderOnce(); });
      this.resizeObserver.observe(host);
    }
    this.scheduleBlink();
    this.renderOnce();
    this.updateLoop();
  }

  // ------------------------------------------------------------ 公共 API

  setSpec(spec: PixelPetSpec): void {
    if (this.destroyed) return;
    if (!this.running) { this.applySpec(spec); this.renderOnce(); return; }
    this.pendingSpec = spec;
    this.poofAt = this.clock;
    this.spawnPoof();
  }

  setState(state: PetVisualState): void {
    if (this.destroyed) return;
    const prev = this.state;
    this.state = { ...state };
    if (state.revision !== prev.revision) {
      this.action = state.action || 'idle';
      this.actionAt = this.clock;
      this.fidget = undefined;
      this.startAction(this.action);
    } else if (state.action !== prev.action && LOOPS.has(state.action)) {
      this.action = state.action;
      this.actionAt = this.clock;
    }
    const nextEyes = (state.expression || 'neutral') as PixelEyeState;
    if (nextEyes !== this.eyes) {
      this.eyes = nextEyes;
      this.expressionAt = this.clock;
      // 表情切换：一个很小的“啵”挤压，配合 70ms 眨眼过渡
      if (!this.isReduced()) { this.sy.v -= 0.9; this.sx.v += 0.6; }
    }
    if (state.visible !== prev.visible) this.visible = state.visible;
    this.updateLoop();
    if (!this.running) this.renderOnce();
  }

  setRoamState(active: boolean, direction: -1 | 0 | 1): void {
    this.roamActive = active;
    this.roamDir = direction;
    if (direction !== 0) this.faceDir = direction;
    if (!this.running) { this.facing.x = this.faceDir; this.renderOnce(); }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.updateLoop();
    if (visible && !this.running) this.renderOnce();
  }

  pointerAt(x: number, y: number): void {
    const head = this.headCenterClient();
    const scale = Math.max(1, this.unit / this.dpr()) * 10;
    this.pointer = { x: clamp((x - head.x) / scale, -1, 1), y: clamp((y - head.y) / scale, -1, 1), at: this.clock };
  }

  touch(x: number, y: number): void {
    this.touchAt = this.clock;
    if (this.isReduced()) { this.renderOnce(); return; }
    this.sy.v -= 2.6; this.sx.v += 2;
    const local = this.clientToLocal(x, y) ?? { x: 0, y: -this.bounds.height * 0.6 };
    this.emit('heart', local.x, local.y - 2, { vy: -9, life: 1.1 });
    if (!this.state.quiet) for (let i = 0; i < 2; i++) this.emit('sparkle', local.x + (i ? 5 : -5), local.y - 1, { vy: -6, life: 0.7 });
  }

  /** 本地手势的小反馈（摸头、蓄力、落地）：只动弹簧和粒子，降低动态效果时不做。 */
  impulse(kind: 'squash' | 'jump' | 'hearts' | 'sparkles' | 'dust', strength = 1): void {
    if (this.destroyed || this.isReduced()) return;
    const s = clamp(strength, 0, 3), top = -this.bounds.height;
    if (kind === 'squash') { this.sy.v -= 4 * s; this.sx.v += 3 * s; }
    if (kind === 'jump') { this.py.v -= 150 * s; this.sy.v += 2.5 * s; this.sx.v -= 1.5 * s; }
    if (kind === 'hearts') for (let i = 0; i < Math.round(1 + 2 * s); i++) this.emit('heart', (Math.random() - 0.5) * 14, top + 1 - i * 2, { vy: -8 - Math.random() * 4, vx: (Math.random() - 0.5) * 5, life: 1.2 });
    if (kind === 'sparkles') for (let i = 0; i < 8; i++) { const ang = (i / 8) * Math.PI * 2; this.emit('sparkle', Math.cos(ang) * 12, top * 0.5 + Math.sin(ang) * 10, { vx: Math.cos(ang) * 7 * s, vy: Math.sin(ang) * 7 * s - 2, life: 0.8, color: i % 2 ? '#ffd75e' : '#9ee6ff' }); }
    if (kind === 'dust') for (let i = 0; i < 6; i++) this.emit('puff', (i - 2.5) * 4, -1, { vx: (i - 2.5) * 6 * s, vy: -2 - Math.random() * 3, life: 0.5, color: i % 2 ? '#ffffff' : '#e9e3f5' });
  }

  dragStart(): void {
    this.dragging = true;
    this.shake = 0;
    this.dragLastDx = 0;
  }

  dragDelta(dx: number, dy: number): void {
    if (!this.dragging) return;
    const dt = 1 / 60;
    this.dragVx = this.dragVx * 0.6 + (dx / dt) * 0.4;
    // 来回快速甩动累积“晕眩值”
    if (Math.abs(dx) > 3 && Math.sign(dx) !== Math.sign(this.dragLastDx) && this.dragLastDx !== 0) this.shake += 0.28;
    if (dx !== 0) this.dragLastDx = dx;
    this.dangle.v -= dx * 0.05;
    this.py.v += dy * 0.02;
  }

  dragEnd(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.dragVx = 0;
    if (this.shake > 1.1) { this.dizzyUntil = this.clock + 2.6; this.actionAt = this.clock; }
    this.shake = 0;
    if (!this.isReduced()) { this.sy.v -= 4.2; this.sx.v += 3.2; this.py.v += 6; }
    if (!this.running) this.renderOnce();
  }

  setMouth(level: number): void {
    this.mouthLevel = Number.isFinite(level) ? clamp(level) : 0;
    if (!this.running) this.renderOnce();
  }

  playText(text: string): void {
    const seconds = clamp((text?.length ?? 0) * 0.09, 2.4, 12);
    this.talkAt = this.clock;
    this.talkUntil = this.clock + seconds;
  }

  hit(x: number, y: number): boolean {
    if (!this.frame || !this.lastMatrix) return false;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const inverse = this.lastMatrix.inverse();
    const [w, h] = this.spec.size;
    const kx = this.canvas.width / rect.width, ky = this.canvas.height / rect.height;
    for (const [ox, oy] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]]) {
      const p = inverse.transformPoint(new DOMPoint((x + ox - rect.left) * kx, (y + oy - rect.top) * ky));
      const sx = Math.floor(p.x), sy = Math.floor(p.y);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      if (this.frame.rgba[(sy * w + sx) * 4 + 3] > 24) return true;
    }
    return false;
  }

  /** Client-space box of the sprite's opaque pixels at its resting pose (ignores bobs and jumps so UI anchored to it stays steady). */
  restBox(): { left: number; top: number; right: number; bottom: number } {
    const rect = this.canvas.getBoundingClientRect(), L = this.layout();
    const kx = rect.width / (L.width || 1), ky = rect.height / (L.height || 1), u = L.unit;
    const cx = rect.left + L.footX * kx, foot = rect.top + L.footY * ky, half = (this.bounds.width * u * kx) / 2;
    return { left: cx - half, right: cx + half, top: foot - this.bounds.height * u * ky, bottom: foot };
  }

  headAnchor(): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const layout = this.layout();
    const kx = rect.width / (this.canvas.width || 1), ky = rect.height / (this.canvas.height || 1);
    return { x: rect.left + layout.footX * kx, y: rect.top + (layout.footY - this.bounds.height * layout.unit) * ky };
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      renderer: 'pixel-canvas', pet: this.spec.id, name: this.spec.name, size: this.spec.size, unit: this.unit,
      canvas: [this.canvas.width, this.canvas.height], running: this.running, visible: this.visible, reducedMotion: this.isReduced(),
      fps: Math.round(this.fps), draws: this.draws, action: this.currentAction().name, revision: this.state.revision,
      expression: this.state.expression, eyes: this.shown.eyes, mouth: this.shown.mouth, legFrame: this.shown.legFrame, blush: this.shown.blush,
      roam: { active: this.roamActive, direction: this.roamDir, facing: this.faceDir }, dragging: this.dragging,
      dizzy: this.clock < this.dizzyUntil, talking: this.clock < this.talkUntil || this.mouthLevel > 0, particles: this.particles.length,
      cachedFrames: this.cache.size, hitGeometry: 'alpha', transition: this.pendingSpec ? 'poof' : 'none',
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.stop();
    this.resizeObserver?.disconnect();
    this.media?.removeEventListener('change', this.onMedia);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.remove();
    this.host.classList.remove('pixel-pet');
    this.cache.clear();
    this.particles = [];
  }

  // ------------------------------------------------------------ 循环

  private isReduced() { return this.state.reducedMotion || !!this.media?.matches; }
  private shouldRun() { return !this.destroyed && this.visible && !this.isReduced() && document.visibilityState !== 'hidden'; }

  private updateLoop() {
    const run = this.shouldRun();
    if (run && !this.running) {
      this.running = true;
      this.lastTs = 0;
      this.raf = requestAnimationFrame(this.tick);
    } else if (!run && this.running) {
      this.stop();
      if (this.pendingSpec) this.applySpec(this.pendingSpec);
      this.particles = [];
      this.renderOnce();
    }
  }

  private stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = (ts: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.lastTs && ts - this.lastTs < FRAME_MS - 1.5) return; // 60 fps 上限
    const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 1 / 60;
    this.lastTs = ts;
    this.fps = this.fps * 0.92 + (1 / Math.max(dt, 1 / 240)) * 0.08;
    this.update(dt);
    this.draw();
  };

  /** 静态帧：降低动态效果 / 不可见时使用。 */
  private renderOnce() {
    if (this.destroyed) return;
    if (!this.running) {
      for (const s of [this.px, this.py, this.rot, this.dangle, this.hold]) { s.x = 0; s.v = 0; }
      this.sx.x = this.sy.x = 1; this.sx.v = this.sy.v = 0;
      this.facing.x = this.faceDir; this.facing.v = 0;
    }
    this.draw(true);
  }

  // ------------------------------------------------------------ 动作

  private amp() {
    const intensity = clamp(this.state.intensity ?? 0.6);
    return (0.55 + 0.45 * intensity) * (this.state.quiet ? 0.55 : 1);
  }

  private currentAction(): { name: string; tau: number; dur: number } {
    const tau = this.clock - this.actionAt;
    if (this.dragging) return { name: 'drag', tau: 0, dur: Infinity };
    if (this.clock < this.dizzyUntil) return { name: 'dizzy', tau: 2.6 - (this.dizzyUntil - this.clock), dur: 2.6 };
    const dur = ONE_SHOT[this.action];
    if (dur && tau < dur) return { name: this.action, tau, dur };
    if (this.state.sleeping) return { name: 'sleep', tau: this.clock, dur: Infinity };
    if (this.state.busy) return { name: 'think', tau: this.clock, dur: Infinity };
    if (LOOPS.has(this.action)) return { name: this.action, tau, dur: Infinity };
    if (this.roamActive && this.roamDir !== 0) return { name: 'walk', tau: this.clock, dur: Infinity };
    return { name: 'idle', tau: this.clock, dur: Infinity };
  }

  private startAction(name: string) {
    if (this.isReduced()) return;
    const a = this.amp(), top = -this.bounds.height;
    if (name === 'celebrate') { this.sy.v -= 3 * a; for (let i = 0; i < 5; i++) this.emit('sparkle', (i - 2) * 6, top + 2 + Math.abs(i - 2) * 2, { vy: -10 - i, vx: (i - 2) * 3, life: 0.9 }); }
    if (name === 'sparkle') for (let i = 0; i < 6; i++) { const ang = (i / 6) * Math.PI * 2; this.emit('sparkle', Math.cos(ang) * 14, top * 0.55 + Math.sin(ang) * 10, { vx: Math.cos(ang) * 4, vy: Math.sin(ang) * 4 - 3, life: 1 }); }
    if (name === 'love') this.emit('heart', 0, top - 1, { vy: -8, life: 1.3 });
    if (name === 'wave') this.emit('note', this.faceDir * 12, top * 0.6, { vy: -7, vx: this.faceDir * 3, life: 1 });
    if (name === 'nod') { this.sy.v -= 1.2 * a; }
  }

  private scheduleBlink() {
    this.nextBlink = this.clock + 2.2 + Math.random() * 3.6;
    this.doubleBlink = Math.random() < 0.22;
  }

  private update(dt: number) {
    this.clock += dt;
    const t = this.clock, a = this.amp();
    const act = this.currentAction();
    const pose: Pose = { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
    let lookX = 0, lookY = 0;

    // 呼吸
    const sleeping = act.name === 'sleep';
    const breathPeriod = sleeping ? 3.6 : 2.8, breath = Math.sin((t / breathPeriod) * Math.PI * 2);
    const breathAmp = (sleeping ? 0.04 : 0.022) * (this.state.quiet ? 0.7 : 1);
    pose.sy += breath * breathAmp; pose.sx -= breath * breathAmp * 0.55;
    const style = this.spec.motion?.style ?? 'walk';
    if (style === 'float') pose.y += Math.sin(t * 1.7) * 1.1 - 1.5;

    // 动作姿态
    const { tau, dur } = act, env = Number.isFinite(dur) ? envelope(tau, dur) : 1;
    switch (act.name) {
      case 'nod': pose.y += 1.3 * a * Math.abs(Math.sin((Math.PI * tau) / 0.45)); lookY = 1; break;
      case 'sway': pose.rot += 0.075 * a * Math.sin((tau / 1.2) * Math.PI * 2) * env; pose.x += 0.9 * a * Math.sin((tau / 1.2) * Math.PI * 2) * env; break;
      case 'peek': pose.x += this.faceDir * 2.4 * a * env; pose.rot += this.faceDir * 0.13 * a * env; lookX = this.faceDir; lookY = -1; break;
      case 'sulk': pose.sy -= 0.06 * env; pose.sx += 0.04 * env; pose.y += 0.6 * env; pose.rot -= this.faceDir * 0.05 * env; lookX = -this.faceDir; lookY = 1; break;
      case 'celebrate': {
        const local = tau % 0.72;
        if (local < 0.56) { pose.y -= 4.2 * a * Math.sin((Math.PI * local) / 0.56); pose.sy += 0.07; pose.sx -= 0.05; } else { pose.sy -= 0.12 * a; pose.sx += 0.1 * a; }
        if (local < dt * 1.5 && tau > 0.1) this.spawnBurst();
        break;
      }
      case 'wave': pose.rot += 0.1 * a * Math.sin((tau / 0.42) * Math.PI * 2) * env; pose.y -= 0.8 * a * env; break;
      case 'sparkle': pose.y -= 1.2 * a * Math.abs(Math.sin(tau * Math.PI * 1.4)) * env; break;
      case 'doodle': pose.rot += 0.03 * Math.sin(tau * 9) * env; pose.y += 0.4 * env; lookY = 1; lookX = Math.sin(tau * 3) > 0 ? 1 : -1; break;
      case 'dizzy': pose.rot += 0.11 * Math.sin((tau / 0.8) * Math.PI * 2) * env; pose.x += 0.8 * Math.sin((tau / 0.8) * Math.PI * 2 + 1) * env; break;
      case 'love': pose.rot += 0.05 * a * Math.sin((tau / 1.1) * Math.PI * 2) * env; pose.y -= 0.6 * env; break;
      case 'sleep': pose.y += 0.6; pose.rot += 0.04 * this.faceDir; lookY = 1; break;
      case 'think': pose.rot += 0.025 * Math.sin(t * 1.3); lookX = Math.floor(t / 2.2) % 2 ? 1 : -1; lookY = -1; break;
      case 'run': case 'walk': break;
      case 'drag': break;
      default: this.updateFidget(pose, a); if (this.fidget) { const f = this.fidget; if (f.kind === 'look') lookX = f.side; } break;
    }

    // 走路 / 跳跃 / 漂浮
    const walking = act.name === 'run' || act.name === 'walk';
    if (walking) {
      const speed = act.name === 'run' ? 10 : 7;
      this.walkPhase += dt * speed;
      if (style === 'hop') { const p = (this.walkPhase / 4) % 1; pose.y -= 3.2 * a * Math.sin(Math.PI * p); if (p > 0.85 || p < 0.06) { pose.sy -= 0.08; pose.sx += 0.07; } }
      else if (style === 'float') { pose.rot += this.faceDir * 0.06; }
      else { pose.y -= 0.9 * Math.abs(Math.sin((this.walkPhase * Math.PI) / 2)); pose.rot += this.faceDir * 0.045 * a; }
      lookX = this.faceDir;
    } else if (style === 'float') this.walkPhase += dt * 4;

    // 被拎起：晃荡 + 拉长
    const holdTarget = this.dragging ? 1 : 0;
    stepSpring(this.hold, holdTarget, dt, 90, 16);
    if (this.dragging) {
      pose.sy += 0.06; pose.sx -= 0.04; pose.y -= 2;
      this.shake = Math.max(0, this.shake - dt * 0.6);
      stepSpring(this.dangle, clamp(-this.dragVx / 1800, -0.5, 0.5), dt, 60, 5);
      this.dragVx *= Math.exp(-dt * 6);
    } else stepSpring(this.dangle, 0, dt, 60, 9);

    // 指针：眼神 + 轻微倾身
    const pointerFresh = t - this.pointer.at < 2.5 && act.name === 'idle';
    if (pointerFresh) {
      if (Math.abs(this.pointer.x) > 0.35) lookX = Math.sign(this.pointer.x);
      if (Math.abs(this.pointer.y) > 0.45) lookY = Math.sign(this.pointer.y);
      pose.rot += this.pointer.x * 0.035 * a;
      pose.x += this.pointer.x * 0.5;
    }
    this.look.x = lookX; this.look.y = lookY;

    // 换角色的“噗”过渡
    const poofTau = t - this.poofAt;
    if (poofTau < 0.16) { const m = 1 - 0.82 * ease(poofTau / 0.16); pose.sx *= m; pose.sy *= m; }
    else if (this.pendingSpec) { this.applySpec(this.pendingSpec); this.sx.x = this.sy.x = 0.2; this.sx.v = 6; this.sy.v = 7; }

    // 眨眼
    if (t >= this.nextBlink) {
      this.blinkUntil = t + 0.12;
      if (this.doubleBlink) { this.nextBlink = t + 0.24; this.doubleBlink = false; } else this.scheduleBlink();
    }

    stepSpring(this.px, pose.x, dt, 140, 17);
    stepSpring(this.py, pose.y, dt, 320, 22);
    stepSpring(this.rot, pose.rot, dt, 150, 15);
    stepSpring(this.sx, pose.sx, dt, 260, 13);
    stepSpring(this.sy, pose.sy, dt, 260, 13);
    stepSpring(this.facing, this.faceDir, dt, 280, 30);

    this.updateParticles(dt, act.name, act.tau);
  }

  private updateFidget(pose: Pose, a: number) {
    const t = this.clock;
    if (!this.fidget && t > this.nextFidget && !this.state.quiet && !this.roamActive) {
      const kinds: Fidget['kind'][] = ['look', 'stretch', 'hop', 'tilt', 'look'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      this.fidget = { kind, start: t, dur: kind === 'hop' ? 0.5 : kind === 'stretch' ? 1.1 : 1.5, side: Math.random() < 0.5 ? -1 : 1 };
    }
    const f = this.fidget;
    if (!f) return;
    const tau = t - f.start;
    if (tau > f.dur) { this.fidget = undefined; this.nextFidget = t + (this.state.quiet ? 14 : 7) + Math.random() * 7; return; }
    const env = envelope(tau, f.dur, 0.25, 0.3);
    if (f.kind === 'stretch') { pose.sy += 0.07 * a * env; pose.sx -= 0.04 * a * env; }
    if (f.kind === 'hop') pose.y -= 2.2 * a * Math.sin(Math.PI * clamp(tau / f.dur));
    if (f.kind === 'tilt') pose.rot += f.side * 0.09 * a * env;
  }

  // ------------------------------------------------------------ 帧状态

  private frameState(): PixelFrameState & { animation?: string } {
    const t = this.clock, act = this.currentAction();
    let eyes: PixelEyeState = this.eyes === 'blink' ? 'blink' : this.eyes;
    if (act.name === 'sleep') eyes = 'sleep';
    else if (act.name === 'dizzy') eyes = 'dizzy';
    else if (act.name === 'love') eyes = 'love';
    else if (act.name === 'celebrate') eyes = 'pleased';
    else if (act.name === 'peek') eyes = 'curious';
    else if (act.name === 'drag') eyes = this.shake > 0.5 ? 'flustered' : this.eyes;
    else if (t - this.touchAt < 0.9) eyes = 'pleased';
    else if (this.fidget?.kind === 'stretch' && t - this.fidget.start > 0.3 && t - this.fidget.start < 0.85) eyes = 'blink';
    const closed = eyes === 'sleep' || eyes === 'blink' || eyes === 'pleased' || eyes === 'love' || eyes === 'dizzy';
    if (!closed && this.running && (t < this.blinkUntil || t - this.expressionAt < 0.07)) eyes = 'blink';

    let mouth: PixelMouth = 'closed';
    if (this.mouthLevel > 0.02) mouth = this.mouthLevel > 0.28 ? 'open' : 'closed';
    else if (t < this.talkUntil) {
      const k = t - this.talkAt;
      mouth = Math.sin(k * Math.PI * 2 * 5.2) + 0.65 * Math.sin(k * Math.PI * 2 * 2.3 + 1) > 0.15 ? 'open' : 'closed';
    } else if (act.name === 'celebrate' || act.name === 'drag') mouth = 'open';
    else if (act.name === 'sulk' || this.state.expression === 'annoyed') mouth = 'pout';
    else if (act.name === 'love' || act.name === 'wave' || eyes === 'pleased' || this.state.expression === 'pleased') mouth = 'smile';

    const walking = act.name === 'run' || act.name === 'walk';
    const style = this.spec.motion?.style ?? 'walk';
    const legCount = this.spec.legs?.length ?? 0;
    let legFrame = 0;
    if (legCount && (walking && style === 'walk' || style === 'float')) legFrame = Math.floor(this.walkPhase) % legCount;
    if (legCount && act.name === 'drag') legFrame = Math.floor(t * 3) % legCount;
    const blush = BLUSHY.has(eyes) || this.state.expression === 'flustered' || this.state.expression === 'softened' || t - this.touchAt < 1.2;
    const extrasPeriod = walking ? 0.7 : act.name === 'sleep' ? 3 : act.name === 'drag' ? 0.45 : 1.6;
    const extrasPhase = Math.floor((((t / extrasPeriod) % 1) * 24)) / 24;
    const rawName = this.spec.frames && (this.spec.frames as Record<string, unknown>)[act.name] ? act.name : undefined;
    this.shown = { eyes, mouth, legFrame, blush };
    return {
      expression: eyes, mouth, legFrame, blush, extrasPhase,
      look: [this.running ? this.look.x : 0, this.running ? this.look.y : 0],
      animation: rawName, frame: rawName ? Math.floor(act.tau * 8) : 0,
    };
  }

  private composed(state: PixelFrameState): Frame {
    const key = `${state.animation ?? ''}:${state.frame}|${state.expression}|${state.mouth}|${state.legFrame}|${state.blush ? 1 : 0}|${state.extrasPhase}|${state.look?.join(',')}`;
    let frame = this.cache.get(key);
    if (!frame) {
      if (this.cache.size > 160) this.cache.clear();
      frame = { key, rgba: gridToRgba(this.spec, composeGrid(this.spec, state)) };
      this.cache.set(key, frame);
    }
    return frame;
  }

  private applySpec(spec: PixelPetSpec) {
    this.spec = spec;
    this.pendingSpec = undefined;
    this.bounds = opaqueBounds(spec);
    this.cache.clear();
    this.frame = undefined;
    this.canvas.dataset.pet = spec.id;
    this.resizeSprite();
  }

  private resizeSprite() {
    const [w, h] = this.spec.size;
    this.sprite.width = w; this.sprite.height = h;
  }

  // ------------------------------------------------------------ 绘制

  private dpr() { return Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1)); }

  private layout() {
    const dpr = this.dpr();
    const cssW = this.host.clientWidth || this.canvas.clientWidth || 160, cssH = this.host.clientHeight || this.canvas.clientHeight || 160;
    const width = Math.max(1, Math.round(cssW * dpr)), height = Math.max(1, Math.round(cssH * dpr));
    // 以 32 像素为基准统一像素大小，较高的角色（带帽子等）只在放不下时才缩小
    const [w, h] = this.spec.size;
    let unit = Math.max(1, Math.floor(Math.min(width * 0.84, height * 0.8) / 32));
    while (unit > 1 && (h * unit > height * 0.92 || w * unit > width * 0.96)) unit--;
    return { width, height, unit, footX: width / 2, footY: height - Math.max(2, Math.round(unit * 2.5)), dpr };
  }

  private draw(staticFrame = false) {
    const ctx = this.ctx, sctx = this.spriteCtx;
    if (!ctx || !sctx) return;
    const L = this.layout();
    if (this.canvas.width !== L.width || this.canvas.height !== L.height) { this.canvas.width = L.width; this.canvas.height = L.height; }
    this.unit = L.unit;
    const state = this.frameState();
    if (staticFrame) state.look = [0, 0];
    const frame = this.composed(state);
    const [w, h] = this.spec.size;
    if (frame !== this.frame) {
      sctx.clearRect(0, 0, w, h);
      sctx.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), w, h), 0, 0);
      this.frame = frame;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, L.width, L.height);
    ctx.imageSmoothingEnabled = false;
    const u = L.unit, b = this.bounds;
    const bodyX = this.px.x * u, bodyY = this.py.x * u;

    // 地面阴影（漂浮 / 跳起时变淡变小）
    const lift = clamp(-this.py.x / 6, 0, 1), floatStyle = this.spec.motion?.style === 'float';
    const shadowW = Math.max(4, Math.round(b.width * (floatStyle ? 0.5 : 0.62) * (1 - lift * 0.35))), shadowAlpha = (floatStyle ? 0.1 : 0.16) * (1 - lift * 0.6) * (1 - this.hold.x);
    if (shadowAlpha > 0.01) {
      ctx.fillStyle = `rgba(40, 28, 60, ${shadowAlpha.toFixed(3)})`;
      const sx0 = Math.round(L.footX + bodyX - (shadowW * u) / 2), sy0 = Math.round(L.footY + (floatStyle ? u * 1.5 : 0) - u / 2);
      ctx.fillRect(sx0 + u, sy0, (shadowW - 2) * u, u);
      ctx.fillRect(sx0, sy0 + u * 0.5, shadowW * u, u * 0.5);
    }

    // 精灵：以脚底（拎起时以头顶）为支点
    const pivotX = b.x + b.width / 2, footPivotY = b.y + b.height, headPivotY = b.y;
    const hold = clamp(this.hold.x), pivotY = footPivotY + (headPivotY - footPivotY) * hold;
    const anchorX = L.footX + bodyX, anchorY = L.footY + bodyY + (headPivotY - footPivotY) * hold * u;
    const facing = Math.abs(this.facing.x) < 0.15 ? Math.sign(this.facing.x || 1) * 0.15 : this.facing.x;
    ctx.translate(anchorX, anchorY);
    ctx.rotate(this.rot.x + this.dangle.x * hold);
    ctx.scale(facing * this.sx.x * u, this.sy.x * u);
    ctx.translate(-pivotX, -pivotY);
    this.lastMatrix = ctx.getTransform();
    ctx.drawImage(this.sprite, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 粒子与头顶符号（不随精灵镜像）
    if (this.running) this.drawParticles(ctx, L.footX + bodyX, L.footY + bodyY, u);
    this.draws++;
  }

  // ------------------------------------------------------------ 粒子

  private emit(kind: ParticleKind, x: number, y: number, o: { vx?: number; vy?: number; life?: number; color?: string; gravity?: number } = {}) {
    if (this.particles.length > 60) this.particles.shift();
    const colors: Record<ParticleKind, string> = { heart: '#ff6b8b', sparkle: '#ffd75e', z: '#8f9cff', star: '#ffcf4a', puff: '#ffffff', scribble: '#7a86ff', drop: '#8fd3ff', note: '#ff8fb8' };
    this.particles.push({ kind, x, y, vx: o.vx ?? 0, vy: o.vy ?? -6, age: 0, life: o.life ?? 1, color: o.color ?? colors[kind], seed: Math.random(), gravity: o.gravity ?? 0 });
  }

  private spawnBurst() {
    const top = -this.bounds.height;
    for (let i = 0; i < (this.state.quiet ? 2 : 4); i++) {
      const ang = Math.PI * (0.15 + 0.7 * (i / 3));
      this.emit('sparkle', Math.cos(ang) * 10, top + 4 - Math.sin(ang) * 4, { vx: Math.cos(ang) * 9, vy: -Math.sin(ang) * 9, life: 0.8, color: i % 2 ? '#ffd75e' : '#9ee6ff' });
    }
  }

  private spawnPoof() {
    const mid = -this.bounds.height / 2;
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      this.emit('puff', Math.cos(ang) * 6, mid + Math.sin(ang) * 6, { vx: Math.cos(ang) * 16, vy: Math.sin(ang) * 12 - 2, life: 0.55, color: i % 2 ? '#ffffff' : '#efe7ff' });
    }
  }

  private updateParticles(dt: number, action: string, tau: number) {
    const top = -this.bounds.height, quiet = this.state.quiet;
    this.spawnClock += dt;
    const every = (period: number) => { if (this.spawnClock >= period) { this.spawnClock = 0; return true; } return false; };
    if (action === 'sleep' && every(quiet ? 2.4 : 1.6)) this.emit('z', this.faceDir * 6, top + 3, { vx: this.faceDir * 2.5, vy: -4, life: 2.4 });
    else if (action === 'love' && every(0.32)) this.emit('heart', (Math.random() - 0.5) * 16, top + 6, { vy: -9, vx: (Math.random() - 0.5) * 4, life: 1.2 });
    else if (action === 'doodle' && every(0.4)) this.emit('scribble', this.faceDir * (9 + Math.random() * 4), -3 - Math.random() * 3, { vy: -2, vx: this.faceDir * 2, life: 0.8 });
    else if (action === 'sulk' && tau > 0.3 && tau < 0.36 + dt) this.emit('puff', -this.faceDir * 9, top * 0.55, { vx: -this.faceDir * 5, vy: -1, life: 0.9, color: '#d8d2e6' });
    else if (action === 'sparkle' && every(0.22)) this.emit('sparkle', (Math.random() - 0.5) * 26, top * (0.2 + Math.random() * 0.7), { vy: -3, life: 0.6, color: Math.random() < 0.5 ? '#ffd75e' : '#ffffff' });
    else if (action === 'wave' && every(0.5)) this.emit('note', this.faceDir * 12, top * 0.6, { vy: -7, vx: this.faceDir * 3, life: 1 });
    else if (action === 'drag' && this.shake > 0.6 && every(0.3)) this.emit('drop', (Math.random() < 0.5 ? -1 : 1) * 10, top + 6, { vy: -6, vx: 0, gravity: 30, life: 0.6 });
    for (const p of this.particles) {
      p.age += dt;
      p.vy += p.gravity * dt;
      p.x += (p.vx + Math.sin((p.age + p.seed) * 5) * (p.kind === 'z' || p.kind === 'heart' ? 2.2 : 0)) * dt;
      p.y += p.vy * dt;
      if (p.kind === 'puff') { p.vx *= Math.exp(-dt * 5); p.vy *= Math.exp(-dt * 5); }
    }
    this.particles = this.particles.filter(p => p.age < p.life);
  }

  private drawParticles(ctx: CanvasRenderingContext2D, ox: number, oy: number, u: number) {
    const pu = Math.max(1, Math.round(u * 0.75)), t = this.clock;
    const bitmap = (rows: string[], x: number, y: number, color: string, alpha: number, size = pu) => {
      if (alpha <= 0.01) return;
      ctx.globalAlpha = clamp(alpha);
      ctx.fillStyle = color;
      const bx = Math.round(ox + x * u - (rows[0].length * size) / 2), by = Math.round(oy + y * u - (rows.length * size) / 2);
      rows.forEach((row, ry) => { for (let rx = 0; rx < row.length; rx++) if (row[rx] === 'x') ctx.fillRect(bx + rx * size, by + ry * size, size, size); });
    };
    for (const p of this.particles) {
      const k = p.age / p.life, alpha = k < 0.15 ? k / 0.15 : 1 - ease((k - 0.55) / 0.45);
      let rows = BITMAPS[p.kind];
      if (p.kind === 'sparkle' && Math.floor((p.age + p.seed) * 10) % 2) rows = SPARKLE_SMALL;
      bitmap(rows, p.x, p.y, p.color, alpha, p.kind === 'puff' ? Math.max(1, Math.round(pu * (1.2 - k * 0.5))) : pu);
    }
    const act = this.currentAction(), top = -this.bounds.height;
    if (act.name === 'think') {
      // “…”：三个点依次出现
      const n = Math.floor((t * 2.2) % 4);
      for (let i = 0; i < n; i++) bitmap(DOT, this.faceDir * (6 + i * 4), top - 2 - i * 1.5, '#7d6fa8', 0.9);
    }
    if (act.name === 'dizzy') {
      for (let i = 0; i < 3; i++) {
        const ang = t * 4.2 + (i * Math.PI * 2) / 3;
        bitmap(BITMAPS.star, Math.cos(ang) * 8, top + 1 + Math.sin(ang) * 2.2, '#ffcf4a', Math.sin(ang) > -0.2 ? 1 : 0.55);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ 坐标

  private headCenterClient() {
    const rect = this.canvas.getBoundingClientRect(), L = this.layout();
    const kx = rect.width / (L.width || 1), ky = rect.height / (L.height || 1);
    return { x: rect.left + L.footX * kx, y: rect.top + (L.footY - this.bounds.height * 0.65 * L.unit) * ky };
  }

  /** 客户端坐标 → 相对脚底的精灵像素坐标（未镜像）。 */
  private clientToLocal(x: number, y: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const L = this.layout();
    const dx = ((x - rect.left) * L.width) / rect.width - L.footX, dy = ((y - rect.top) * L.height) / rect.height - L.footY;
    return { x: clamp(dx / L.unit, -20, 20), y: clamp(dy / L.unit, -this.bounds.height - 4, 0) };
  }
}
