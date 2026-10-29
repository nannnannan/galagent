// 像素小人渲染器演示 / 冒烟测试：每只内置小人播放一个不同动作，并检查公共 API。
import { PixelPet, type PetVisualState } from '../../../runtime/renderer/pixel-pet';
import { builtinPixelPets } from '../../../runtime/shared/pixel-pets';

const ACTIONS = ['celebrate', 'sleep', 'think', 'dizzy', 'love', 'run', 'wave', 'nod', 'sulk', 'sparkle', 'doodle', 'peek', 'sway', 'idle'];
const LABELS: Record<string, string> = { celebrate: '庆祝', sleep: '睡觉', think: '思考', dizzy: '晕眩', love: '爱心', run: '奔跑', wave: '挥手', nod: '点头', sulk: '闹别扭', sparkle: '闪亮', doodle: '涂鸦', peek: '偷看', sway: '摇摆', idle: '待机' };
const grid = document.getElementById('grid')!;
const pets: PixelPet[] = [];
const params = new URLSearchParams(location.search);
const loopFor = Number(params.get('ms') ?? 1200);

builtinPixelPets.forEach((spec, i) => {
  const cell = document.createElement('div'); cell.className = 'cell';
  const host = document.createElement('div'); host.className = 'host';
  const action = ACTIONS[i % ACTIONS.length];
  const label = document.createElement('div'); label.textContent = `${spec.name} · ${LABELS[action]}`;
  cell.append(host, label); grid.append(cell);
  const pet = new PixelPet(host, spec);
  const state: PetVisualState = { expression: i % 4 === 1 ? 'curious' : 'neutral', action, revision: 1, visible: true, reducedMotion: false, quiet: false, intensity: 0.8, sleeping: action === 'sleep', busy: action === 'think' };
  pet.setState(state);
  if (action === 'run') pet.setRoamState(true, -1);
  pets.push(pet);
});

const out: Record<string, unknown> = {};
const first = pets[0], rect = first.canvas.getBoundingClientRect();
setTimeout(() => { first.playText('你好呀，今天也一起加油吧！'); pets[1].setSpec(builtinPixelPets[4]); }, 200);
setTimeout(() => {
  const head = first.headAnchor();
  out.hitCenter = first.hit(rect.left + rect.width / 2, head.y + rect.height * 0.25);
  out.hitCorner = first.hit(rect.left + 2, rect.top + 2);
  out.headAnchor = head;
  out.canvasRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  first.touch(rect.left + rect.width / 2, head.y + 20);
  pets[3].dragStart(); for (let i = 0; i < 8; i++) pets[3].dragDelta(i % 2 ? 18 : -18, 0); pets[3].dragEnd();
}, Math.max(100, loopFor - 400));
setTimeout(() => {
  out.diagnostics = pets.map(p => p.getDiagnostics());
  out.ok = out.hitCenter === true && out.hitCorner === false && pets.every(p => (p.getDiagnostics().draws as number) > 1);
  document.getElementById('out')!.textContent = JSON.stringify(out);
  document.title = out.ok ? 'PASS' : 'FAIL';
}, loopFor);
