import type { AppSnapshot, GalAgentBridge, PetAction } from '../shared/contracts';
import { PixelPet } from './pixel-pet';
import { splitReply } from '../shared/reply';
import { SpeechPlayback } from './speech-playback';
import { VoicePlayer } from './voice';
import { AchievementWatcher, Fling, FLING_MIN_SPEED, Mischief, Murmurer, Orbit, Petting, Stare, busyLabeler, chatReaction, chimeCaption, dayKey, firstGreeting, holdLines, idleCaption, isMidnight, midnightCaption, orbitLines, patLines, releaseVelocity, seasonFor, stareLines, tickleLines, wallLines, welcomeBackLines, type MoveSample, type Season } from './fun';
import { Ambient, confetti } from './effects';
import { firstVisitToday, reportAchievement, trackPet } from './bond';
import { bridge, command, onCommand } from './ui';
import { loadPet, wantedPet } from './pet-assets';
import { builtinPixelPets } from '../shared/pixel-pets';

const pickOne = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
const seasons: Season[] = ['snow', 'petals', 'fireflies', 'leaves', 'none'];

export function startPetView(app: HTMLElement, initial: AppSnapshot) {
  document.body.classList.add('pet-view');
  app.innerHTML = `<main class="pet-stage">
    <div class="pet-overhead" id="overhead">
      <div id="bubble" class="pet-bubble" role="status" aria-live="polite"><p></p></div>
      <div id="status-chip" class="status-chip" aria-live="polite"><i class="status-icon" aria-hidden="true"></i><span></span></div>
    </div>
    <div id="pet-body" class="pet-body"><div class="pet-sprite"></div></div>
    <button class="pet-handle" type="button" aria-label="打开菜单" title="菜单"><span aria-hidden="true">⋯</span></button>
    <form id="pet-input" class="pet-input" hidden>
      <textarea id="pet-text" rows="2" maxlength="1200" aria-label="说点什么" placeholder="想说点什么…"></textarea>
      <div class="pet-input-actions"><small id="pet-input-note"></small><button id="pet-input-close" type="button" class="btn ghost">收起</button><button type="submit" class="btn primary">发送</button></div>
    </form>
  </main>`;
  const stage = app.querySelector<HTMLElement>('.pet-stage')!, body = app.querySelector<HTMLElement>('#pet-body')!, host = body.querySelector<HTMLElement>('.pet-sprite')!;
  const bubble = app.querySelector<HTMLElement>('#bubble')!, bubbleText = bubble.querySelector('p')!, chip = app.querySelector<HTMLElement>('#status-chip')!, chipText = chip.querySelector('span')!, overhead = app.querySelector<HTMLElement>('#overhead')!;
  const input = app.querySelector<HTMLFormElement>('#pet-input')!, text = app.querySelector<HTMLTextAreaElement>('#pet-text')!, note = app.querySelector<HTMLElement>('#pet-input-note')!;
  let snapshot = initial, petId = '', loading = 0, stateRevision = 0, lastVisual = -1, firstSnapshot = true, lastSpoken = -1;
  let localAction: { action: PetAction; until: number } | undefined;
  let shownSpec = builtinPixelPets[0];
  const pet = new PixelPet(host, shownSpec);
  const mischief = new Mischief(), petting = new Petting(), watcher = new AchievementWatcher(), stare = new Stare(4000), orbit = new Orbit();
  let lastInteraction = Date.now(), lastUserMessage = initial.messages.filter(m => m.role === 'user').at(-1)?.id || '', lastActivity = initial.activity;
  const touched = () => { lastInteraction = Date.now(); };
  const funOn = () => snapshot.settings.funCaptions !== false;
  const reduce = () => snapshot.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Seasonal particles behind the pet (a ?season= override exists for previews only).
  const ambient = new Ambient(stage), forcedSeason = new URLSearchParams(location.search).get('season') as Season | null;
  const syncAmbient = () => ambient.set(forcedSeason && seasons.includes(forcedSeason) ? forcedSeason : seasonFor(), snapshot.settings.funCaptions !== false && !reduce() && canAnimate());
  setInterval(syncAmbient, 10 * 60_000);
  const voice = new VoicePlayer(level => pet.setMouth(level), line => pet.playText(line));
  const speech = new SpeechPlayback({
    synthesize: line => bridge.synthesizeSpeech?.(line) || Promise.resolve({ ok: false, error: '语音服务不可用。' }),
    cancel: () => bridge.cancelSpeech?.(),
    stop: () => voice.stop(),
    play: async (res, line, current) => { if (!current()) return; if (res.audioBase64) await voice.playAudio(res.audioBase64, res.mimeType || 'audio/wav', current); else if (res.provider === 'web-speech') voice.speakFallback(line, snapshot.settings.ttsSpeed || 1); },
  });
  onCommand(value => { if (['chat.send', 'chat.cancel', 'tts.stop', 'tts.configure', 'persona.select'].includes(value.type) || (value.type === 'settings.update' && ['ttsEnabled', 'quietUntil', 'companionMode'].some(k => k in value.settings))) speech.stop(); });
  bridge.onSpeechStop?.(() => speech.stop(false));
  window.addEventListener('beforeunload', () => speech.stop());

  // ---- visibility: animate only while the window is actually shown ----
  let nativeVisible: boolean | undefined;
  const canAnimate = () => !document.hidden && (bridge.getWindowVisibility || bridge.onWindowVisibility ? nativeVisible === true : true);
  const syncVisibility = () => { document.body.classList.toggle('not-visible', !canAnimate()); pet.setVisible(canAnimate()); syncAmbient(); };
  document.addEventListener('visibilitychange', syncVisibility);
  bridge.onWindowVisibility?.(visible => { nativeVisible = visible; syncVisibility(); });
  bridge.getWindowVisibility?.().then(visible => { if (nativeVisible === undefined) { nativeVisible = visible; syncVisibility(); } }).catch(() => { nativeVisible = true; syncVisibility(); });
  if (!bridge.getWindowVisibility) syncVisibility();

  // ---- overhead: speech bubble with a typewriter reveal, status chip, idle captions ----
  let bubbleTimer: ReturnType<typeof setTimeout> | undefined, typeTimer: ReturnType<typeof setInterval> | undefined, captionTimer: ReturnType<typeof setTimeout> | undefined;
  let caption = '', captionUntil = 0;
  let partTimer: ReturnType<typeof setTimeout> | undefined;
  const hideBubble = () => { clearTimeout(partTimer); bubble.classList.remove('visible'); clearInterval(typeTimer); pet.playText(''); refreshPointer(); updateChip(); };
  /** A reply written as short paragraphs plays like several messages: each part types out, then the next replaces it. */
  const showBubble = (line: string) => {
    clearTimeout(partTimer);
    const parts = snapshot.settings.splitReplies !== false ? splitReply(line) : undefined;
    if (!parts) { showPart(line); return; }
    const play = (i: number) => { showPart(parts[i]); if (i < parts.length - 1) partTimer = setTimeout(() => play(i + 1), Math.min(6500, 1400 + [...parts[i]].length * 110)); };
    play(0);
  };
  const showPart = (line: string) => {
    clearTimeout(bubbleTimer); clearInterval(typeTimer);
    if (!line) { hideBubble(); return; }
    const chars = [...line]; let shown = 0;
    bubbleText.textContent = ''; bubble.classList.add('visible'); bubble.classList.toggle('long', chars.length > 60);
    const reduce = snapshot.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) bubbleText.textContent = line;
    else typeTimer = setInterval(() => { shown = Math.min(chars.length, shown + Math.max(1, Math.round(chars.length / 70))); bubbleText.textContent = chars.slice(0, shown).join(''); if (shown >= chars.length) clearInterval(typeTimer); }, 28);
    pet.playText(line);
    const seconds = snapshot.settings.bubbleSeconds ?? 12;
    bubbleTimer = setTimeout(hideBubble, Math.min(600_000, seconds * 1000 + chars.length * 70));
    updateChip(); refreshPointer();
  };
  bubble.addEventListener('click', hideBubble);
  let captionKind = 'fun';
  const say = (line: string, ms = 3200, kind = 'fun') => {
    // A trophy line is never overwritten by a casual caption while it is up.
    if (captionKind === 'trophy' && kind !== 'trophy' && Date.now() < captionUntil) return;
    caption = line; captionKind = kind; captionUntil = Date.now() + ms; updateChip(); setTimeout(updateChip, ms + 50);
  };
  // Claude-Code-style rotating words while a reply is cooking or a task runs; plain label when fun captions are off.
  const busyText = busyLabeler();
  let tickerTimer: ReturnType<typeof setInterval> | undefined;
  const busyLabel = (a: NonNullable<AppSnapshot['activity']>) => {
    const text = busyText(a, snapshot.persona?.active.thinkingLines || []);
    if (text === undefined) { clearInterval(tickerTimer); tickerTimer = undefined; return a.label; }
    if (!tickerTimer) tickerTimer = setInterval(() => { if (canAnimate()) updateChip(); }, 500);
    return funOn() ? text : a.label;
  };
  function updateChip() {
    const a = snapshot.activity, bubbleOpen = bubble.classList.contains('visible');
    let label = '', kind: string = a?.kind || 'idle';
    const busy = a ? busyLabel(a) : '';
    if (caption && Date.now() < captionUntil) { label = caption; kind = captionKind; }
    else if (a && a.kind !== 'idle') label = busy;
    chip.dataset.kind = kind;
    const show = !!label && !(bubbleOpen && kind !== 'thinking' && kind !== 'working' && kind !== 'trophy');
    if (show) chipText.textContent = label;
    chipText.classList.toggle('spark-text', (kind === 'thinking' || kind === 'working') && funOn() && !snapshot.activity?.waiting);
    chip.classList.toggle('visible', show);
  }
  const scheduleCaption = () => {
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => {
      if (snapshot.settings.funCaptions !== false && snapshot.activity?.kind === 'idle' && !bubble.classList.contains('visible') && canAnimate()) say(idleCaption(snapshot, Date.now() - lastInteraction), 5200);
      scheduleCaption();
    }, 28_000 + Math.random() * 40_000);
  };
  scheduleCaption();
  // 头顶小嘀咕: a one-line reaction to the kind of app in front (process name only), never stored.
  const murmurer = new Murmurer();
  setInterval(() => {
    const line = murmurer.note(snapshot.observation?.available ? snapshot.observation.appName : undefined, Date.now());
    if (!line || snapshot.settings.murmursEnabled === false || !funOn() || snapshot.activity?.kind !== 'idle' || bubble.classList.contains('visible') || !canAnimate() || snapshot.settings.quietUntil > Date.now() || snapshot.settings.companionMode === 'rest') return;
    say(line, 3800);
  }, 5000);
  // Hourly chime: a quiet caption on the hour while idle; 1–4 am it becomes a nudge to rest.
  const inQuietHours = (now: Date) => {
    const q = snapshot.settings.quietHours; if (!q?.enabled) return false;
    const minutes = now.getHours() * 60 + now.getMinutes(), at = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    const start = at(q.start), end = at(q.end);
    return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  };
  let chimed = '';
  setInterval(() => {
    const now = new Date(), key = `${dayKey(now)}-${now.getHours()}`;
    if (now.getMinutes() !== 0 || chimed === key) return;
    chimed = key;
    if (snapshot.settings.funCaptions === false || snapshot.activity?.kind !== 'idle' || bubble.classList.contains('visible') || !canAnimate() || snapshot.settings.quietUntil > Date.now() || inQuietHours(now)) return;
    const line = chimeCaption(now); if (line) say(line, 6000);
  }, 15_000);
  // The overhead follows the sprite's head so jumps and bobs carry the bubble along.
  const follow = () => {
    const anchor = pet.headAnchor(), rect = stage.getBoundingClientRect();
    overhead.style.setProperty('--head-x', `${Math.round(anchor.x - rect.left)}px`); overhead.style.setProperty('--head-y', `${Math.round(anchor.y - rect.top)}px`);
    if (handleOn()) placeHandle();
  };
  setInterval(() => { if (canAnimate()) follow(); }, 50);

  // ---- pointer: click-through except over the sprite and our own controls ----
  let drag: { x: number; y: number; moved: boolean } | null = null, latest: { x: number; y: number } | null = null, frame = 0, lastInteractive: boolean | undefined;
  const contains = (element: HTMLElement, x: number, y: number) => { const r = element.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; };
  // Menu handle: appears when the pointer reaches the pet, sits just off the sprite's lower right,
  // and lingers HANDLE_LINGER ms after the pointer leaves (fading for the last part) so it can be reached.
  const handle = app.querySelector<HTMLElement>('.pet-handle')!, HANDLE_LINGER = 2500, HANDLE_FADE = 900;
  let handleUntil = 0, handleTimer: ReturnType<typeof setTimeout> | undefined;
  const handleOn = () => stage.classList.contains('handle-on');
  function placeHandle() {
    const box = pet.restBox(), rect = stage.getBoundingClientRect(), size = handle.offsetWidth || 36;
    const x = Math.max(4, Math.min(rect.width - size - 4, box.right - rect.left - 6)), y = Math.max(4, Math.min(rect.height - size - 4, box.bottom - rect.top - size - 2));
    handle.style.setProperty('--handle-x', `${Math.round(x)}px`); handle.style.setProperty('--handle-y', `${Math.round(y)}px`);
  }
  function tickHandle() {
    clearTimeout(handleTimer);
    const left = handleUntil - Date.now();
    if (left <= 0) { stage.classList.remove('handle-on', 'handle-fading'); refreshPointer(); return; }
    stage.classList.toggle('handle-fading', left <= HANDLE_FADE);
    handleTimer = setTimeout(tickHandle, left > HANDLE_FADE ? left - HANDLE_FADE : left);
  }
  function showHandle() {
    handleUntil = Date.now() + HANDLE_LINGER;
    if (!handleOn()) { placeHandle(); stage.classList.add('handle-on'); }
    tickHandle();
  }
  const overHandle = (x: number, y: number) => handleOn() && contains(handle, x, y);
  /** Called for every pointer sample (DOM move or native hit test): reaching the pet or the handle keeps the handle up. */
  const notePointer = (x: number, y: number) => { if (drag || overHandle(x, y) || pet.hit(x, y)) showHandle(); playful(x, y); };
  /** Hover-only games: resting the cursor on the pet (stare) and circling around it (orbit). */
  const playful = (x: number, y: number) => {
    const free = !drag && !hold && !fling && input.hidden && funOn() && !bubble.classList.contains('visible');
    if (stare.move(free && pet.hit(x, y))) { touched(); localEffect('peek', 1800); say(pickOne(stareLines), 2800); reportAchievement('stare', snapshot); }
    const box = pet.restBox();
    if (free && orbit.move(x, y, (box.left + box.right) / 2, (box.top + box.bottom) / 2)) { touched(); localEffect('dizzy', 2000); say(pickOne(orbitLines), 2600); reportAchievement('orbit', snapshot); }
    else if (!free) orbit.reset();
  };
  const interactive = (x: number, y: number) => !!drag || overHandle(x, y) || (!input.hidden && contains(input, x, y)) || (bubble.classList.contains('visible') && contains(bubble, x, y)) || pet.hit(x, y);
  const setInteractive = (value: boolean) => { if (value === lastInteractive) return; lastInteractive = value; stage.classList.toggle('hovered', value); void command({ type: 'shell.pointer', interactive: value }, true); };
  function refreshPointer() { if (frame) return; frame = requestAnimationFrame(() => { frame = 0; setInteractive(!!drag || (!!latest && interactive(latest.x, latest.y))); }); }
  // ---- gestures: pat (hover strokes over the head), hold-to-charge, fling, taps ----
  let hold: { start: number; raf: number; charged: boolean; nagged?: boolean } | undefined, fling: { sim: Fling; raf: number } | undefined, samples: MoveSample[] = [];
  const overHead = (x: number, y: number) => {
    const a = pet.headAnchor(), r = body.getBoundingClientRect(), height = r.bottom - 4 - a.y;
    return height > 0 && Math.abs(x - a.x) < r.width * 0.32 && y >= a.y - 8 && y <= a.y + height * 0.5;
  };
  /** Midnight and first-of-the-day lines take precedence over a gesture's own caption. */
  const noteInteraction = (): string | undefined => {
    const now = new Date();
    if (isMidnight(now)) { firstVisitToday(now); reportAchievement('midnight', snapshot); return midnightCaption; }
    return firstVisitToday(now) ? firstGreeting(now, snapshot.bond) : undefined;
  };
  const stroke = (x: number, y: number, buttons = 0) => {
    if (drag || buttons || hold || fling || !input.hidden) { petting.reset(); return; }
    const result = petting.move(x, overHead(x, y));
    if (result === 'stroke') pet.impulse('hearts', 0);
    if (result !== 'pat') return;
    touched(); localEffect('love', 2400); pet.impulse('hearts', 1);
    say(noteInteraction() || pickOne(patLines), 3400);
    reportAchievement('pat', snapshot);
    void command({ type: 'pet.interact', interaction: 'pat' }, true);
  };
  const endHold = () => { if (hold) cancelAnimationFrame(hold.raf); hold = undefined; stage.classList.remove('charging', 'charged'); stage.style.removeProperty('--charge'); };
  const startHold = () => {
    const current: { start: number; raf: number; charged: boolean; nagged?: boolean } = { start: performance.now(), raf: 0, charged: false }; hold = current;
    const step = () => {
      if (hold !== current) return;
      if (drag?.moved) { endHold(); return; }
      const level = Math.max(0, Math.min(1, ((performance.now() - current.start) / 1000 - 0.25) / 0.95));
      stage.style.setProperty('--charge', level.toFixed(3)); stage.classList.toggle('charging', level > 0);
      if (level >= 1 && !current.charged) { current.charged = true; stage.classList.add('charged'); pet.impulse('sparkles', 1); say('蓄力完成！松手！', 2200); }
      if (!current.nagged && performance.now() - current.start > 6000) { current.nagged = true; say(pickOne(holdLines), 2400); }
      current.raf = requestAnimationFrame(step);
    };
    current.raf = requestAnimationFrame(step);
  };
  const chargeJump = () => {
    localEffect('celebrate', 1500); pet.impulse('jump', 1.5);
    const a = pet.headAnchor(); confetti({ x: a.x, y: a.y }, 18, 0.55);
    say(noteInteraction() || pickOne(['咻——！', '起飞！', '看我跳得多高！']), 2600);
    reportAchievement('charge', snapshot);
  };
  const stopFling = (caught: boolean) => {
    if (!fling) return;
    cancelAnimationFrame(fling.raf); const sim = fling.sim; fling = undefined;
    if (caught) { say('接住啦！', 2000); return; }
    pet.impulse('squash', 1.2); pet.impulse('dust', 1);
    if (sim.startSpeed > 2.6) { localEffect('dizzy', 2200); say('转、转晕了…', 2600); } else say(pickOne(['呼——安全着陆！', '飞起来了！', '再来一次！']), 2400);
    reportAchievement('fling', snapshot);
  };
  const startFling = (vx: number, vy: number) => {
    const sim = new Fling(vx, vy); let last = performance.now(), bumped = false;
    const bump = () => { pet.impulse('squash', 0.6); if (!bumped && sim.speed > 1.2) { bumped = true; say(pickOne(wallLines), 1800); } };
    const step = (ts: number) => {
      if (!fling || fling.sim !== sim) return;
      const r = sim.step(ts - last); last = ts;
      // Soft bounce off the work-area edges so the throw feels physical; the main process clamps anyway.
      const sc = window.screen as Screen & { availLeft?: number; availTop?: number }, left = sc.availLeft ?? 0, top = sc.availTop ?? 0;
      let { dx, dy } = r;
      const nx = window.screenX + dx, ny = window.screenY + dy;
      if ((dx < 0 && nx < left) || (dx > 0 && nx + window.outerWidth > left + sc.availWidth)) { sim.bounce('x'); dx = 0; bump(); }
      if ((dy < 0 && ny < top) || (dy > 0 && ny + window.outerHeight > top + sc.availHeight)) { sim.bounce('y'); dy = 0; bump(); }
      if (dx || dy) void command({ type: 'shell.drag', dx, dy }, true);
      if (r.done) stopFling(false); else fling.raf = requestAnimationFrame(step);
    };
    fling = { sim, raf: requestAnimationFrame(step) };
  };

  (bridge as GalAgentBridge).onHitTest?.(point => { latest = point; pet.pointerAt(point.x, point.y); stroke(point.x, point.y); notePointer(point.x, point.y); const value = interactive(point.x, point.y); stage.classList.toggle('hovered', value); return value; });
  const track = (event: MouseEvent) => { latest = { x: event.clientX, y: event.clientY }; pet.pointerAt(event.clientX, event.clientY); stroke(event.clientX, event.clientY, event.buttons); notePointer(event.clientX, event.clientY); refreshPointer(); };
  app.addEventListener('pointermove', track); app.addEventListener('mousemove', track);
  app.addEventListener('pointerleave', () => { petting.reset(); if (bridge.onHitTest) return; latest = null; if (!drag) setInteractive(false); });
  body.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !pet.hit(event.clientX, event.clientY)) return;
    if (fling) stopFling(true); // caught mid-air
    drag = { x: event.screenX, y: event.screenY, moved: false }; body.setPointerCapture(event.pointerId); setInteractive(true); stage.classList.add('held');
    samples = [{ x: event.screenX, y: event.screenY, t: performance.now() }]; petting.reset(); startHold();
  });
  body.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.screenX - drag.x, dy = event.screenY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) pet.dragStart();
    drag.moved = true; drag.x = event.screenX; drag.y = event.screenY;
    pet.dragDelta(dx, dy);
    samples = [...samples.slice(-7), { x: event.screenX, y: event.screenY, t: performance.now() }];
    const dizzy = mischief.drag(dx);
    if (dizzy) { localEffect('dizzy', 2600); say(dizzy); reportAchievement('dizzy', snapshot); }
    void command({ type: 'shell.drag', dx, dy }, true);
  });
  const release = (event: PointerEvent) => {
    if (!drag) return;
    const moved = drag.moved, held = hold ? performance.now() - hold.start : 0, charged = !!hold?.charged;
    drag = null; stage.classList.remove('held'); endHold(); touched();
    if (moved) {
      pet.dragEnd();
      const v = releaseVelocity(samples, performance.now());
      if (!reduce() && Math.hypot(v.vx, v.vy) >= FLING_MIN_SPEED) startFling(v.vx, v.vy);
      else { const special = noteInteraction(); if (special) say(special, 4200); }
      void command({ type: 'pet.interact', interaction: 'drag' }, true);
    } else if (charged) chargeJump();
    else if (held < 450) {
      pet.touch(event.clientX, event.clientY);
      if (snapshot.vitality?.tone === 'asleep' && funOn()) { localEffect('wave', 1600); say(pickOne(['唔…你叫我？', '（揉眼睛）嗯…？', '我醒啦…']), 2800); }
      const special = noteInteraction(), poke = mischief.tap(), box = pet.restBox(), feet = event.clientY > box.bottom - (box.bottom - box.top) * 0.2;
      if (feet && !poke && !special && funOn()) { localEffect('celebrate', 1200); pet.impulse('jump', 0.5); say(pickOne(tickleLines), 2400); reportAchievement('tickle', snapshot); }
      else if (poke) { localEffect(poke.dizzy ? 'dizzy' : 'sulk', 2200); say(special || poke.line, special ? 4200 : 3200); reportAchievement(poke.dizzy ? 'dizzy' : 'poke', snapshot); }
      else if (special) say(special, 4200);
      void command({ type: 'pet.interact', interaction: 'tap' }, true);
    }
    // A hold released before it charged simply fizzles: no tap, no model reaction.
    samples = []; refreshPointer();
  };
  body.addEventListener('pointerup', release);
  body.addEventListener('pointercancel', () => { if (drag?.moved) pet.dragEnd(); drag = null; endHold(); samples = []; stage.classList.remove('held'); refreshPointer(); });
  body.addEventListener('dblclick', event => { if (pet.hit(event.clientX, event.clientY)) void openInput(); });
  app.addEventListener('contextmenu', event => { event.preventDefault(); if (interactive(event.clientX, event.clientY)) void command({ type: 'shell.menu' }); });
  handle.addEventListener('click', () => { showHandle(); void command({ type: 'shell.menu' }); });
  handle.addEventListener('focus', showHandle);
  bridge.onRoamState?.(state => pet.setRoamState(state.active, state.direction));

  // ---- quick input ----
  let composing = false;
  const closeInput = async () => { input.hidden = true; stage.classList.remove('input-open'); await command({ type: 'shell.input', open: false }, true); refreshPointer(); };
  const openInput = async () => { input.hidden = false; stage.classList.add('input-open'); note.textContent = snapshot.provider.configured ? '' : '尚未连接模型，可从菜单打开「连接」。'; const result = await command({ type: 'shell.input', open: true }, true); if (result.ok) text.focus(); refreshPointer(); };
  app.querySelector('#pet-input-close')!.addEventListener('click', () => void closeInput());
  text.addEventListener('compositionstart', () => composing = true); text.addEventListener('compositionend', () => composing = false);
  text.addEventListener('keydown', event => { if (event.isComposing || composing) return; if (event.key === 'Escape') { event.preventDefault(); void closeInput(); } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); input.requestSubmit(); } });
  input.onsubmit = async event => {
    event.preventDefault(); const value = text.value.trim(); if (!value || snapshot.status.busy) return;
    note.textContent = '发送中…'; const result = await command({ type: 'chat.send', text: value });
    if (result.ok) { text.value = ''; note.textContent = ''; void closeInput(); } else note.textContent = result.error || '没有发出去，文字已保留。';
  };

  // ---- state ----
  function localEffect(action: PetAction, ms: number) { localAction = { action, until: Date.now() + ms }; stateRevision++; applyState(); setTimeout(() => { if (localAction && Date.now() >= localAction.until) { localAction = undefined; stateRevision++; applyState(); } }, ms + 30); }
  function applyState() {
    const a = snapshot.activity?.kind, local = localAction && Date.now() < localAction.until ? localAction.action : undefined;
    pet.setState({ expression: snapshot.visual.expression, action: local || snapshot.visual.action, revision: stateRevision, visible: canAnimate(), reducedMotion: snapshot.settings.reducedMotion, quiet: snapshot.settings.quietUntil > Date.now() || a === 'quiet' || a === 'resting', intensity: snapshot.visual.intensity, busy: snapshot.status.busy || a === 'working', sleeping: a === 'sleeping' && !snapshot.visual.bubble });
  }
  async function syncSprite() {
    const id = wantedPet(snapshot), revision = snapshot.pets?.revision || 0, key = `${id}@${revision}`;
    if (key === petId) return; petId = key; const ticket = ++loading;
    const spec = await loadPet(id, revision);
    // Built-ins resolve to the same object; only a different (or re-imported) spec plays the swap animation.
    if (ticket === loading && spec !== shownSpec) { shownSpec = spec; pet.setSpec(spec); }
    follow();
  }
  let trackedPet = '';
  const celebrate = (title: string) => {
    say(`解锁成就：${title}`, 5200, 'trophy');
    pet.impulse('sparkles', 1.2);
    if (canAnimate()) { const a = pet.headAnchor(); confetti({ x: a.x, y: a.y - 10 }, 24, 0.6); }
  };
  function render(next: AppSnapshot) {
    const speechPolicyChanged = snapshot.settings.ttsEnabled !== next.settings.ttsEnabled || snapshot.settings.quietUntil !== next.settings.quietUntil || snapshot.settings.companionMode !== next.settings.companionMode;
    if ((!snapshot.status.busy && next.status.busy) || speechPolicyChanged) speech.stop();
    snapshot = next;
    document.body.classList.toggle('reduced-motion', next.settings.reducedMotion);
    void syncSprite();
    if (lastVisual !== next.visual.revision) {
      lastVisual = next.visual.revision; stateRevision++;
      showBubble(next.visual.bubble);
      if (!firstSnapshot && next.visual.bubble && next.settings.ttsEnabled && next.settings.companionMode !== 'rest' && next.settings.quietUntil <= Date.now() && lastSpoken !== next.visual.revision) { lastSpoken = next.visual.revision; void speech.speak(next.visual.bubble); }
    }
    firstSnapshot = false;
    const wearing = wantedPet(next); if (wearing !== trackedPet) { trackedPet = wearing; trackPet(wearing, next); }
    // The user's newest message may carry a word the pet reacts to locally (hearts for 谢谢, confetti for 生日快乐…).
    const newest = next.messages.filter(m => m.role === 'user').at(-1);
    if (newest && newest.id !== lastUserMessage) {
      lastUserMessage = newest.id; touched();
      const reaction = funOn() ? chatReaction(newest.text) : undefined;
      if (reaction && canAnimate()) {
        localEffect(reaction.action, 1800); say(reaction.line, 2400); reportAchievement('chat-react', snapshot);
        if (reaction.effect === 'confetti') { if (!reduce()) { const a = pet.headAnchor(); confetti({ x: a.x, y: a.y - 10 }, 28, 0.6); } pet.impulse('sparkles', 1); }
        else pet.impulse(reaction.effect, 1);
      }
    }
    // Back from being away: the dozing pet perks up.
    if (lastActivity?.away && next.activity?.kind === 'idle' && funOn() && canAnimate()) { localEffect('wave', 2000); pet.impulse('jump', 0.6); say(pickOne(welcomeBackLines), 3200); }
    lastActivity = next.activity;
    watcher.update(next.bond).forEach((a, i) => setTimeout(() => celebrate(a.title), i * 5400));
    syncAmbient(); applyState(); updateChip(); refreshPointer();
  }
  render(initial);
  return render;
}
