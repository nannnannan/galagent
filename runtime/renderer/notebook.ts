import { MIRA_DEFAULT_BASE_URL, MIRA_DEFAULT_MODEL } from '../shared/provider';
import type { AppSnapshot, Expression, MemoryItem, Message, PetAction, SandboxSettings, SettingsPatch, TaskRunDetail, TaskRunView } from '../shared/contracts';
import { companionModes, topicLabels, validTopic } from '../shared/companionship';
import { achievements as achievementDefs } from '../shared/achievements';
import { builtinPixelPets } from '../shared/pixel-pets';
import { PixelPet } from './pixel-pet';
import { SpeechPlayback } from './speech-playback';
import { VoicePlayer } from './voice';
import { typingDelay } from '../shared/reply';
import { AchievementWatcher, Mischief, Petting, busyLabeler, chatReaction, konami, patLines } from './fun';
import { renderMarkdown } from './markdown';
import { confetti, trophyToast } from './effects';
import { openPalette, type PaletteAction } from './palette';
import { reportAchievement, trackPet } from './bond';
import { builtinPet, loadPet, wantedPet } from './pet-assets';
import { guidePanel, openPersonaEditor, personaBadges } from './persona-editor';
import { svgIcon } from './icons';
import { attachVoice } from './voice-input';
import { MCP_PRESETS, type McpPreset } from '../shared/mcp-presets';
import qrcode from 'qrcode-generator';
import { DEFAULT_CONTEXT_WINDOW, ENDPOINT_LABEL, STT_FORMATS, STT_PRESETS, TTS_FORMATS, rankModels, type EndpointKind, type ModelInfo } from '../shared/endpoints';
import { PROFILE_GROUPS, groupMemories, recentFocus, type Rhythm } from '../shared/profile';
import { bridge, button, clockText, command, el, field, iconBadge, linesArea, notice, numberInput, onCommand, readFileText, relativeTime, section, select, toast, toggle } from './ui';

type Page = { id: string; icon: string; title: string; intro: string; key: (s: AppSnapshot) => unknown; render: (root: HTMLElement, s: AppSnapshot) => void };
const settings = (patch: SettingsPatch) => command({ type: 'settings.update', settings: patch });
// Partial patches only: the core merges them, so a stale page can never revert another switch or mask a preset.
const sandbox = (_s: AppSnapshot, patch: Partial<SandboxSettings>) => settings({ sandbox: patch });
const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
const dayLabel = (day: string) => { const d = new Date(`${day}T12:00:00`); return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }); };
const tip = <T extends HTMLElement>(element: T, text: string, side: 'top' | 'bottom' | 'right' = 'bottom') => { element.dataset.tip = text; element.dataset.tipSide = side; if (!element.getAttribute('aria-label') && !element.textContent?.trim()) element.setAttribute('aria-label', text); return element; };

// Page-level resources (small animated pets) are released whenever the page re-renders.
let pageGeneration = 0, pageDisposers: (() => void)[] = [];
const disposePage = () => { pageGeneration++; for (const dispose of pageDisposers.splice(0)) dispose(); };
/** A small animated copy of the current pet for empty states and cards. */
function miniPet(s: AppSnapshot, action: PetAction, expression: Expression = 'neutral', className = 'mini-pet') {
  const host = el('div', className); host.setAttribute('aria-hidden', 'true');
  const generation = pageGeneration;
  void loadPet(wantedPet(s), s.pets?.revision || 0).then(spec => {
    if (generation !== pageGeneration) return;
    const pet = new PixelPet(host, spec);
    pet.setState({ expression, action, revision: 1, visible: true, reducedMotion: s.settings.reducedMotion, quiet: false, sleeping: action === 'sleep' });
    pageDisposers.push(() => pet.destroy());
  });
  return host;
}
/** The one empty state: a tiny pet doing something fitting, one line, optional action. `compact` sits inline in a card. */
function emptyPet(s: AppSnapshot, text: string, action: PetAction = 'idle', extra?: HTMLElement, compact = false) {
  const box = el('div', `empty${compact ? ' compact' : ''}`); box.append(miniPet(s, action, action === 'sleep' ? 'neutral' : 'curious'), el('p', '', text));
  if (extra) box.append(extra);
  return box;
}

export function startNotebook(app: HTMLElement, initial: AppSnapshot) {
  let snapshot = initial, page = 'chat', pageKey = '', lastMessages = '', enterTimer: ReturnType<typeof setTimeout> | undefined;
  app.innerHTML = `<main class="notebook">
    <aside class="sidebar">
      <div class="brand"><button class="brand-mark icon-badge solid" type="button" aria-label="GalAgent">◆</button><span>GalAgent<small>桌面伙伴</small></span></div>
      <div class="companion">
        <div class="portrait"><div class="portrait-pet"></div><div class="portrait-text"><h2 id="portrait-name"></h2><p id="portrait-tagline"></p><span id="portrait-status" class="pill"></span><small id="portrait-mood" class="portrait-mood"></small></div></div>
        <button id="bond-card" class="bond-card" type="button">
          <span class="bond-line"><span>陪伴第 <b id="bond-days">1</b> 天</span><span class="pill gold" id="bond-trophies"></span></span>
          <span class="progress" aria-hidden="true"><i id="bond-bar"></i></span>
          <span class="bond-chips"><span id="bond-streak"></span><span aria-hidden="true">·</span><span id="bond-today"></span></span>
        </button>
      </div>
      <nav class="nav" aria-label="页面"></nav>
      <footer class="sidebar-foot"><span id="foot-stats"></span><button id="pet-return" class="btn ghost small" type="button">回到桌面</button></footer>
    </aside>
    <section class="workspace">
      <header class="titlebar"><div class="title"><h1 id="page-title"></h1><p id="page-intro"></p></div><div id="page-tools" class="page-tools"><button id="palette-open" class="btn ghost small" type="button"><span>快捷操作</span><kbd>Ctrl</kbd><kbd>K</kbd></button></div></header>
      <div id="chat-page" class="chat-page">
        <div id="messages" class="messages" aria-live="polite"></div>
        <div id="agent-questions"></div>
        <form id="composer" class="composer">
          <div id="runtime-error" class="notice warn" hidden></div>
          <div class="composer-box"><textarea id="input" rows="1" maxlength="12000" placeholder="说点什么…  (Enter 发送，Shift+Enter 换行，/任务 xxx 交给执行器)"></textarea>
          <button id="mic" class="btn ghost round" hidden></button><button id="send" class="btn primary round" type="submit" aria-label="发送"></button></div>
          <div class="composer-foot"><span id="thinking" class="thinking" hidden><i></i><i></i><i></i> <span id="thinking-text">正在想</span></span><span class="spacer"></span><button id="stop-voice" class="btn ghost small" type="button">停止朗读</button><button id="cancel" class="btn ghost small" type="button">取消回复</button><button id="quiet" class="btn ghost small" type="button">安静一会</button></div>
        </form>
      </div>
      <div id="content-page" class="content-page" hidden></div>
    </section>
  </main>`;
  let portraitSpec = builtinPixelPets[0];
  const portraitHost = app.querySelector<HTMLElement>('.portrait-pet')!;
  const portrait = new PixelPet(portraitHost, portraitSpec);
  let portraitKey = '';
  const voice = new VoicePlayer(level => portrait.setMouth(level), line => portrait.playText(line));
  const speech = new SpeechPlayback({
    synthesize: line => bridge.synthesizeSpeech?.(line) || Promise.resolve({ ok: false, error: '语音服务不可用。' }),
    cancel: () => bridge.cancelSpeech?.(), stop: () => voice.stop(),
    play: async (res, line, current) => { if (!current()) return; if (res.audioBase64) await voice.playAudio(res.audioBase64, res.mimeType || 'audio/wav', current); else if (res.provider === 'web-speech') voice.speakFallback(line, snapshot.settings.ttsSpeed || 1); },
  });
  onCommand(value => { if (['chat.send', 'chat.cancel', 'tts.stop', 'tts.configure'].includes(value.type)) speech.stop(); });
  bridge.onSpeechStop?.(() => speech.stop(false));
  konami(() => {
    void command({ type: 'pet.emote', action: 'celebrate', bubble: '隐藏关卡解锁！↑↑↓↓←→←→BA' });
    confetti(undefined, 60); reportAchievement('konami', snapshot);
  });
  const watcher = new AchievementWatcher();

  const nav = app.querySelector<HTMLElement>('.nav')!, content = app.querySelector<HTMLElement>('#content-page')!, chatPage = app.querySelector<HTMLElement>('#chat-page')!;
  pages.forEach((p, i) => {
    const b = button('', () => go(p.id), 'nav-item'); b.dataset.page = p.id;
    b.append(iconBadge(p.icon, 'sm'), el('span', 'nav-label', p.title));
    if (i < 10) b.append(el('kbd', 'nav-key', `${(i + 1) % 10}`));
    tip(b, i < 10 ? `${p.title} · Ctrl+${(i + 1) % 10}` : p.title, 'right');
    // Groups: talk · who · how TA behaves · records · system.
    if (['tasks', 'persona', 'companion', 'memory', 'privacy'].includes(p.id)) nav.append(el('div', 'nav-sep'));
    nav.append(b);
  });
  function go(id: string) {
    page = id; pageKey = '';
    nav.querySelectorAll<HTMLElement>('[data-page]').forEach(b => { const on = b.dataset.page === id; b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    chatPage.hidden = id !== 'chat'; content.hidden = id === 'chat';
    // Only a page switch animates in; snapshot-driven re-renders of the same page stay still.
    content.classList.remove('enter'); void content.offsetWidth; content.classList.add('enter');
    clearTimeout(enterTimer); enterTimer = setTimeout(() => content.classList.remove('enter'), 700);
    if (id !== 'chat') content.scrollTop = 0;
    else { disposePage(); content.replaceChildren(); } // hidden pages shouldn't keep little pets animating
    render(snapshot, true);
  }
  app.querySelector('#send')!.append(svgIcon('arrowUp', 18)!);
  attachVoice(app.querySelector<HTMLButtonElement>('#mic')!, app.querySelector<HTMLTextAreaElement>('#input')!);
  // The title bar gains a hairline once the page scrolls under it.
  const titlebar = app.querySelector<HTMLElement>('.titlebar')!;
  const markScroll = (event: Event) => titlebar.classList.toggle('scrolled', (event.target as HTMLElement).scrollTop > 4);
  content.addEventListener('scroll', markScroll, { passive: true });
  app.querySelector('#pet-return')!.addEventListener('click', () => void command({ type: 'shell.chat', open: false }));
  app.querySelector('#bond-card')!.addEventListener('click', () => go('achievements'));
  tip(app.querySelector<HTMLElement>('#bond-card')!, '查看成就与羁绊', 'right');

  // ---- little sidebar easter eggs: pat or poke the portrait, click the logo seven times ----
  let portraitRevision = 0, portraitVisual = -1, portraitLocal: { action: PetAction; until: number } | undefined;
  const portraitPetting = new Petting(4, 1800, 5000), portraitMischief = new Mischief();
  function applyPortrait() {
    const s = snapshot, local = portraitLocal && Date.now() < portraitLocal.until ? portraitLocal.action : undefined;
    if (s.visual.revision !== portraitVisual) { portraitVisual = s.visual.revision; portraitRevision++; }
    portrait.setState({ expression: s.visual.expression, action: local || s.visual.action, revision: portraitRevision, visible: !document.hidden, reducedMotion: s.settings.reducedMotion, quiet: s.settings.quietUntil > Date.now(), intensity: s.visual.intensity, busy: s.status.busy, sleeping: s.activity?.kind === 'sleeping' && !local });
  }
  function portraitEffect(action: PetAction, ms: number) {
    portraitLocal = { action, until: Date.now() + ms }; portraitRevision++; applyPortrait();
    setTimeout(() => { if (portraitLocal && Date.now() >= portraitLocal.until) { portraitLocal = undefined; portraitRevision++; applyPortrait(); } }, ms + 30);
  }
  const portraitStatus = app.querySelector<HTMLElement>('#portrait-status')!;
  let statusLine: { text: string; until: number } | undefined;
  const sidebarSay = (text: string, ms = 2600) => { statusLine = { text, until: Date.now() + ms }; renderStatus(); setTimeout(renderStatus, ms + 30); };
  // Rotating Claude-Code-style words while busy, shared by the portrait pill and the composer's "正在想".
  const busyText = busyLabeler(), thinkingText = app.querySelector<HTMLElement>('#thinking-text')!, statusText = el('span');
  let busyTimer: ReturnType<typeof setInterval> | undefined;
  function renderStatus() {
    const own = statusLine && Date.now() < statusLine.until, fun = snapshot.settings.funCaptions !== false;
    const busy = busyText(snapshot.activity, snapshot.persona?.active.thinkingLines || []);
    if (busy !== undefined && !busyTimer) busyTimer = setInterval(() => { if (!document.hidden) renderStatus(); }, 500);
    if (busy === undefined && busyTimer) { clearInterval(busyTimer); busyTimer = undefined; }
    // The name already heads the card: “星野 · 星空时间” reads as just “星空时间” here.
    const who = snapshot.identity.name || snapshot.persona?.active.name || '';
    const label = busy !== undefined && fun ? busy : (snapshot.activity?.label || '').replace(who ? new RegExp(`^${who.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*·\\s*`) : /^$/, '');
    const sparkle = !own && busy !== undefined && fun;
    if (statusText.parentElement !== portraitStatus) portraitStatus.replaceChildren(statusText);
    statusText.textContent = own ? statusLine!.text : label; statusText.classList.toggle('spark-text', sparkle); portraitStatus.dataset.kind = own ? 'fun' : snapshot.activity?.kind || 'idle';
    thinkingText.textContent = busy !== undefined && fun ? busy : '正在想'; thinkingText.classList.toggle('spark-text', busy !== undefined && fun);
  }
  const overPortraitHead = (x: number, y: number) => { const a = portrait.headAnchor(), r = portraitHost.getBoundingClientRect(); return Math.abs(x - a.x) < r.width * 0.28 && y >= a.y - 8 && y <= a.y + (r.bottom - a.y) * 0.5; };
  portraitHost.addEventListener('pointermove', event => {
    if (event.buttons) { portraitPetting.reset(); return; }
    const result = portraitPetting.move(event.clientX, overPortraitHead(event.clientX, event.clientY));
    portraitHost.classList.toggle('touchable', portrait.hit(event.clientX, event.clientY));
    if (result === 'stroke') portrait.impulse('hearts', 0);
    if (result === 'pat') { portraitEffect('love', 2400); portrait.impulse('hearts', 1); sidebarSay(pick(patLines)); reportAchievement('pat', snapshot); }
  });
  portraitHost.addEventListener('pointerleave', () => { portraitPetting.reset(); portraitHost.classList.remove('touchable'); });
  portraitHost.addEventListener('click', event => {
    if (!portrait.hit(event.clientX, event.clientY)) return;
    portrait.touch(event.clientX, event.clientY);
    const poke = portraitMischief.tap();
    if (poke) { portraitEffect(poke.dizzy ? 'dizzy' : 'sulk', 2200); sidebarSay(poke.line); reportAchievement(poke.dizzy ? 'dizzy' : 'poke', snapshot); }
  });
  let logoClicks: number[] = [];
  app.querySelector<HTMLElement>('.brand-mark')!.addEventListener('click', event => {
    const now = performance.now(); logoClicks = [...logoClicks.filter(t => now - t < 3000), now];
    const mark = event.currentTarget as HTMLElement; mark.classList.remove('spin'); void mark.offsetWidth; mark.classList.add('spin');
    if (logoClicks.length >= 7) { logoClicks = []; const r = mark.getBoundingClientRect(); confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, 40); toast('你发现了一个没什么用的彩蛋。今天也辛苦啦！'); portraitEffect('celebrate', 1500); }
  });

  // ---- chat ----
  const input = app.querySelector<HTMLTextAreaElement>('#input')!, messagesBox = app.querySelector<HTMLElement>('#messages')!;
  let composing = false;
  input.addEventListener('compositionstart', () => composing = true); input.addEventListener('compositionend', () => composing = false);
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(180, input.scrollHeight) + 'px'; };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing) { event.preventDefault(); app.querySelector<HTMLFormElement>('#composer')!.requestSubmit(); } });
  app.querySelector<HTMLFormElement>('#composer')!.onsubmit = async event => {
    event.preventDefault(); const text = input.value.trim(); if (!text || snapshot.status.busy) return;
    input.value = ''; input.style.height = 'auto'; stickToBottom = true;
    const result = await command({ type: 'chat.send', text }); if (!result.ok && !input.value) { input.value = text; autosize(); }
  };
  const sendButton = tip(app.querySelector<HTMLButtonElement>('#send')!, '发送 · Enter', 'top');
  void sendButton;
  app.querySelector('#cancel')!.addEventListener('click', () => void command({ type: 'chat.cancel' }));
  app.querySelector('#stop-voice')!.addEventListener('click', () => void command({ type: 'tts.stop' }));
  const toggleQuiet = () => void settings({ quietUntil: snapshot.settings.quietUntil > Date.now() ? 0 : Date.now() + 30 * 60_000 });
  app.querySelector('#quiet')!.addEventListener('click', toggleQuiet);

  // Messages already on screen never animate again; only genuinely new ones pop in.
  const seen = new Set<string>();
  let firstPaint = true, stickToBottom = true, helloPet: PixelPet | undefined;
  messagesBox.addEventListener('scroll', markScroll, { passive: true });
  messagesBox.addEventListener('scroll', () => { stickToBottom = messagesBox.scrollHeight - messagesBox.scrollTop - messagesBox.clientHeight < 120; }, { passive: true });
  function renderMessages() {
    helloPet?.destroy(); helloPet = undefined;
    const box = messagesBox;
    if (!snapshot.messages.length) {
      const hello = el('div', 'hello'); const p = snapshot.persona?.active;
      const stage = el('div', 'hello-pet'); stage.setAttribute('aria-hidden', 'true');
      hello.append(stage, el('h3', '', p ? `和${p.name}打个招呼吧` : '故事从一句话开始'), el('p', '', p?.greeting || '告诉 TA 怎么称呼你，或者说一件想让 TA 记住的小事。'));
      const chips = el('div', 'chips');
      for (const line of ['你好呀，介绍一下你自己', '30 分钟后提醒我喝水', '帮我整理一下今天的待办']) chips.append(button(line, () => { input.value = line; autosize(); input.focus(); }, 'chip'));
      hello.append(chips); box.replaceChildren(hello);
      void loadPet(wantedPet(snapshot), snapshot.pets?.revision || 0).then(spec => {
        if (!stage.isConnected) return;
        helloPet = new PixelPet(stage, spec);
        helloPet.setState({ expression: 'pleased', action: 'wave', revision: 1, visible: true, reducedMotion: snapshot.settings.reducedMotion, quiet: false });
      });
      firstPaint = false; return;
    }
    const scrollFromBottom = box.scrollHeight - box.scrollTop;
    box.replaceChildren();
    let lastDay = '', freshUser = false;
    for (const message of snapshot.messages) {
      const day = new Date(message.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
      if (day !== lastDay) { box.append(el('div', 'day-rule pill', day)); lastDay = day; }
      const fresh = !firstPaint && !seen.has(message.id); seen.add(message.id);
      if (fresh && message.role === 'user') freshUser = true;
      const row = el('article', `message ${message.role}${message.source === 'scene' ? ' system' : ''}${fresh ? ' fresh' : ''}`);
      const who = message.role === 'user' ? '你' : message.speaker || snapshot.identity.name || 'TA';
      const meta = el('div', 'message-meta');
      meta.append(el('span', '', `${who} · ${new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}${message.source === 'initiative' ? ' · 主动开口' : ''}${message.afterthought ? ' · 补了一句' : ''}`));
      if (message.channel === 'wechat') meta.append(el('span', 'pill wechat', '微信'));
      const copy = tip(button('', async () => { try { await navigator.clipboard.writeText(message.text); toast('已复制到剪贴板'); } catch { toast('复制失败', 'error'); } }, 'icon-btn message-copy'), '复制', 'top');
      copy.append(svgIcon('copy', 14)!); copy.setAttribute('aria-label', '复制这条消息'); meta.append(copy);
      let body: HTMLElement;
      if (message.role === 'assistant' && message.parts && message.parts.length > 1) {
        // Sent as several short messages: each part is its own bubble, typed out one after another when new.
        body = el('div', 'message-parts'); let delay = 0;
        for (const part of message.parts) { const bubble = el('div', 'message-text md part'); bubble.innerHTML = renderMarkdown(part); if (fresh) { bubble.style.setProperty('--delay', `${delay}ms`); delay += typingDelay(part); } body.append(bubble); }
      }
      else if (message.role === 'assistant') { body = el('div', 'message-text md'); body.innerHTML = renderMarkdown(message.text); }
      else body = el('p', 'message-text', message.text);
      row.append(meta, body);
      appendFeedback(row, message); box.append(row);
    }
    const last = snapshot.messages[snapshot.messages.length - 1];
    if (snapshot.status.busy && last?.role === 'user') {
      const typing = el('article', 'message assistant typing fresh'); typing.setAttribute('aria-label', '正在输入');
      const dots = el('div', 'message-text'); dots.append(el('i'), el('i'), el('i'));
      typing.append(el('div', 'message-meta', `${snapshot.identity.name || 'TA'} 正在输入…`), dots); box.append(typing);
    }
    if (firstPaint || stickToBottom || freshUser) { box.style.scrollBehavior = firstPaint ? 'auto' : ''; box.scrollTop = box.scrollHeight; box.style.scrollBehavior = ''; }
    else box.scrollTop = box.scrollHeight - scrollFromBottom;
    firstPaint = false;
  }
  function appendFeedback(row: HTMLElement, message: Message) {
    const topics = message.initiativeTopics?.filter(validTopic) || [];
    if (message.role !== 'assistant' || message.source !== 'initiative' || !topics.length) return;
    const panel = el('div', 'feedback');
    panel.append(el('small', '', topics.map(t => topicLabels[t]).join(' · ')));
    for (const [value, label] of [['welcome', '这种挺好'], ['mute', '这类先别提']] as const) {
      const b = button(label, async () => { const r = await command({ type: 'initiative.feedback', messageId: message.id, value }); if (r.ok) toast(value === 'welcome' ? '记下了，会参考你的偏好。' : '这类主动话题已暂停，可在「陪伴」页恢复。'); }, 'chip small');
      b.setAttribute('aria-pressed', String(snapshot.companionship?.ratings[message.id] === value)); panel.append(b);
    }
    panel.append(button('安静 30 分钟', () => void settings({ quietUntil: Date.now() + 30 * 60_000 }), 'chip small'));
    row.append(panel);
  }
  function renderQuestions() {
    const host = app.querySelector<HTMLElement>('#agent-questions')!;
    const requests = snapshot.agent?.questions || [], signature = JSON.stringify(requests.map(q => q.id));
    if (host.dataset.signature === signature) return; host.dataset.signature = signature; host.replaceChildren();
    for (const request of requests) {
      const form = el('form', 'card question'), head = el('header', 'card-head'), title = el('div'); const settingsAsk = request.questions[0]?.header === 'TA 想修改设置'; title.append(el('h3', '', settingsAsk ? 'TA 想帮你改设置' : request.questions[0]?.header === '运行命令' ? '执行器想运行一条命令' : '执行任务需要你的选择'), el('p', 'hint', settingsAsk ? '这些改动会放宽隐私或权限，需要你点一下同意。' : '执行器在等你决定，选一个或写下你的回答。')); head.append(iconBadge('🧭', 'accent'), title); form.append(head);
      const fields: { question: string; choices: HTMLInputElement[]; custom: HTMLInputElement }[] = [];
      for (const [index, q] of request.questions.entries()) {
        const set = el('fieldset'); set.append(el('legend', '', q.question)); const choices: HTMLInputElement[] = [];
        for (const option of q.options) { const label = el('label', 'choice'), box = el('input'); box.type = q.multi_select ? 'checkbox' : 'radio'; box.name = request.id + '-' + index; box.value = option.label; choices.push(box); label.append(box, el('span', '', option.label + (option.description ? ` — ${option.description}` : ''))); set.append(label); }
        const custom = el('input'); custom.placeholder = '或者写下你的回答'; set.append(custom); fields.push({ question: q.question, choices, custom }); form.append(set);
      }
      const submit = el('button', 'btn primary', '提交'); submit.type = 'submit';
      const actions = el('div', 'row'); actions.append(submit, button('暂不回答', () => void command({ type: 'agent.answer', id: request.id, answers: {} }), 'btn ghost')); form.append(actions);
      form.onsubmit = async event => { event.preventDefault(); const answers: Record<string, string> = Object.create(null); for (const f of fields) { const a = f.custom.value.trim() || f.choices.filter(c => c.checked).map(c => c.value).join('、'); if (a) answers[f.question] = a; } await command({ type: 'agent.answer', id: request.id, answers }); };
      host.append(form);
    }
  }

  // ---- command palette & keyboard shortcuts ----
  const editing = () => { const a = document.activeElement as HTMLElement | null; return !!a && (['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) || a.isContentEditable); };
  function paletteActions(): PaletteAction[] {
    const s = snapshot, list: PaletteAction[] = [], quiet = s.settings.quietUntil > Date.now();
    list.push(
      { id: 'quiet', group: '常用', icon: quiet ? '🔔' : '🤫', title: quiet ? '恢复主动开口' : '安静 30 分钟', hint: quiet ? '现在处于安静中' : 'TA 暂时不会主动开口', keywords: 'quiet 安静 免打扰 勿扰', run: toggleQuiet },
      { id: 'reminder', group: '常用', icon: '⏰', title: '新建提醒…', hint: '到点后 TA 会来找你', keywords: 'schedule remind 定时 闹钟', run: () => { go('schedule'); setTimeout(() => content.querySelector<HTMLInputElement>('.schedule-form input')?.focus(), 60); } },
      { id: 'remember', group: '常用', icon: '📌', title: '让 TA 记住一件事…', keywords: 'memory 记忆', run: () => { go('memory'); setTimeout(() => content.querySelector<HTMLTextAreaElement>('.inline-form textarea')?.focus(), 60); } },
      { id: 'celebrate', group: '常用', icon: '🎉', title: '让 TA 庆祝一下', keywords: 'celebrate 庆祝 跳', run: () => void command({ type: 'pet.emote', action: 'celebrate' }) },
      { id: 'roam', group: '常用', icon: '🚶', title: '出去溜达一圈', keywords: 'roam walk 漫步', run: () => void command({ type: 'pet.roam', active: true }) },
      { id: 'stop-voice', group: '常用', icon: '🔇', title: '停止朗读', keywords: 'tts voice 语音', run: () => void command({ type: 'tts.stop' }) },
    );
    for (const mode of companionModes) if ((s.settings.companionMode || 'daily') !== mode.value) list.push({ id: `mode:${mode.value}`, group: '陪伴模式', icon: mode.value === 'focus' ? '🎯' : mode.value === 'rest' ? '🌙' : '☀️', title: `切换到「${mode.label}」`, hint: mode.description, keywords: 'mode 模式', run: () => void settings({ companionMode: mode.value }) });
    pages.forEach((p, i) => list.push({ id: `page:${p.id}`, group: '页面', icon: p.icon, title: `前往「${p.title}」`, shortcut: i < 10 ? `Ctrl+${(i + 1) % 10}` : undefined, keywords: `${p.id} ${p.intro}`, run: () => go(p.id) }));
    for (const p of s.persona?.list || []) if (p.id !== s.persona?.active.id) list.push({ id: `persona:${p.id}`, group: '切换角色', icon: '🎭', title: `切换到「${p.name}」`, hint: p.tagline, keywords: 'persona character 角色', run: () => void command({ type: 'persona.select', id: p.id }) });
    const current = wantedPet(s);
    for (const p of s.pets?.catalog?.length ? s.pets.catalog : builtinPixelPets) if (p.id !== current) list.push({ id: `pet:${p.id}`, group: '换小人', icon: '🐾', title: `换上「${p.name}」`, hint: p.description, keywords: 'pet sprite 小人', run: () => void command({ type: 'pet.select', id: p.id }) });
    list.push(
      { id: 'lockdown', group: '隐私与其他', icon: '🔒', title: '一键隐私锁定', hint: '停止观察、中止任务并切到严格沙箱', keywords: 'privacy lock 隐私 锁定 沙箱', run: async () => { if (!confirm('立即停止桌面观察、中止进行中的任务，并切换到严格沙箱？')) return; const r = await command({ type: 'privacy.lockdown' }); if (r.ok) toast('已停止观察、中止任务并切换到严格沙箱。'); } },
      { id: 'corner', group: '隐私与其他', icon: '🏠', title: '小人回到屏幕角落', keywords: 'reset position 位置', run: () => void command({ type: 'shell.resetPosition' }) },
      { id: 'desk', group: '隐私与其他', icon: '🖥️', title: '回到桌面', hint: '收起这个窗口', keywords: 'close hide 关闭', run: () => void command({ type: 'shell.chat', open: false }) },
      { id: 'export', group: '隐私与其他', icon: '📦', title: '导出相处存档', keywords: 'export backup 备份', run: () => void command({ type: 'app.export' }) },
    );
    return list;
  }
  const palette = () => openPalette(paletteActions());
  app.querySelector('#palette-open')!.addEventListener('click', palette);
  window.addEventListener('keydown', event => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); palette(); return; }
    if (document.querySelector('.palette-backdrop')) return;
    if (mod && !event.shiftKey && !event.altKey && /^[0-9]$/.test(event.key)) { const target = pages[event.key === '0' ? 9 : Number(event.key) - 1]; if (target) { event.preventDefault(); go(target.id); } return; }
    if (event.key === '/' && !mod && !editing()) { event.preventDefault(); if (page !== 'chat') go('chat'); input.focus(); }
  });

  // ---- shell-wide state ----
  async function syncPortrait() {
    const id = wantedPet(snapshot), key = `${id}@${snapshot.pets?.revision || 0}`;
    if (key === portraitKey) return; portraitKey = key; trackPet(id, snapshot);
    const spec = await loadPet(id, snapshot.pets?.revision || 0); if (spec !== portraitSpec) { portraitSpec = spec; portrait.setSpec(spec); }
  }
  let lastVisual = -1, lastUserMessage = initial.messages.filter(m => m.role === 'user').at(-1)?.id || '';
  function renderBond(next: AppSnapshot) {
    const bond = next.bond, list = bond?.achievements?.length ? bond.achievements : achievementDefs, unlocked = bond?.achievements.filter(a => a.unlockedAt).length || 0;
    app.querySelector('#bond-days')!.textContent = String(Math.max(1, bond?.daysTogether || 1));
    app.querySelector('#bond-streak')!.textContent = `连续 ${Math.max(bond?.streakDays || 0, 0)} 天`;
    app.querySelector('#bond-today')!.textContent = `今天聊了 ${bond?.todayChats ?? 0} 次`;
    app.querySelector('#bond-trophies')!.textContent = `徽章 ${unlocked}/${list.length}`;
    app.querySelector<HTMLElement>('#bond-bar')!.style.width = `${Math.round((unlocked / Math.max(1, list.length)) * 100)}%`;
  }
  function render(next: AppSnapshot, force = false) {
    if (!snapshot.status.busy && next.status.busy) speech.stop();
    snapshot = next;
    document.body.classList.toggle('reduced-motion', next.settings.reducedMotion);
    void syncPortrait();
    if (lastVisual !== next.visual.revision) { lastVisual = next.visual.revision; portrait.playText(next.visual.bubble); }
    applyPortrait();
    for (const a of watcher.update(next.bond)) trophyToast(a);
    const p = next.persona?.active;
    app.querySelector('#portrait-name')!.textContent = next.identity.name || p?.name || 'TA';
    app.querySelector('#portrait-tagline')!.textContent = p?.tagline || '';
    const mood = app.querySelector<HTMLElement>('#portrait-mood')!; mood.textContent = next.vitality ? `心情：${next.vitality.label}` : ''; mood.dataset.tone = next.vitality?.tone || '';
    renderStatus(); renderBond(next);
    app.querySelector('#foot-stats')!.textContent = `${next.stats.memories} 件记忆 · ${next.stats.conversations} 次相处`;
    const current = pages.find(x => x.id === page)!;
    app.querySelector('#page-title')!.textContent = current.title; app.querySelector('#page-intro')!.textContent = current.intro;
    // chat
    const error = app.querySelector<HTMLElement>('#runtime-error')!; error.textContent = next.status.error || (!next.provider.configured ? '还没有连接模型：到「连接」页填入 API 地址、模型和 Key 就能开始真实对话。' : ''); error.hidden = !error.textContent;
    app.querySelector('#thinking')!.toggleAttribute('hidden', !next.status.busy);
    app.querySelector<HTMLButtonElement>('#send')!.disabled = next.status.busy;
    app.querySelector<HTMLButtonElement>('#mic')!.hidden = !next.settings.voiceInputEnabled;
    const quiet = app.querySelector<HTMLElement>('#quiet')!; quiet.textContent = next.settings.quietUntil > Date.now() ? '恢复主动' : '安静一会'; quiet.classList.toggle('on', next.settings.quietUntil > Date.now());
    const signature = JSON.stringify([next.messages.map(m => m.id + m.text.length), next.companionship?.ratings, p?.id, next.status.busy, next.identity.name]);
    if (signature !== lastMessages) { lastMessages = signature; renderMessages(); }
    const newest = next.messages.filter(m => m.role === 'user').at(-1);
    if (newest && newest.id !== lastUserMessage) {
      lastUserMessage = newest.id;
      const reaction = next.settings.funCaptions !== false ? chatReaction(newest.text) : undefined;
      if (reaction) { portraitEffect(reaction.action, 1800); portrait.impulse(reaction.effect === 'confetti' ? 'sparkles' : reaction.effect, 1); sidebarSay(reaction.line, 2400); }
    }
    renderQuestions();
    if (page === 'chat') return;
    // Forms keep their DOM (and the user's half-typed text) until the page's own data changes.
    const key = JSON.stringify(current.key(next));
    const typing = content.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement!.tagName);
    if (!force && (key === pageKey || typing)) return;
    pageKey = key;
    const scroll = content.scrollTop; disposePage(); content.replaceChildren(); current.render(content, next); content.scrollTop = scroll;
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (page !== 'chat' && !content.contains(document.activeElement)) render(snapshot); }, 0));
  const requested = new URLSearchParams(location.search).get('page');
  go(pages.some(p => p.id === requested) ? requested! : 'chat');
  render(initial, true);
  return (next: AppSnapshot) => render(next);
}

// ---------------- pages ----------------
// Every page is a stack of `section()` cards; rows inside use .field / .list-row, picks use .selectable,
// empty states use emptyPet(), status lines use notice(). No page sets its own colours or radii.
const pages: Page[] = [
  { id: 'chat', icon: '💬', title: '聊天', intro: '日常聊天、提醒和交给执行器的任务都在这里。', key: () => 0, render: () => {} },
  { id: 'tasks', icon: 'terminal', title: '任务', intro: '交给执行代理的每一件事：做了什么、改了哪些文件、花了多久，改动可以单独撤销。', key: s => [s.taskHistory, s.agent?.running, s.agent?.busy], render: renderTasks },
  { id: 'persona', icon: '🎭', title: '角色', intro: '选择一位角色，或者写一张属于你自己的角色卡。', key: s => [s.persona?.active.id, s.persona?.list.map(p => p.id + p.updatedAt), s.bond?.daysTogether], render: renderPersonas },
  { id: 'pets', icon: '🐾', title: '小人', intro: '换一个桌面小人形象，或导入自己画的像素小人。', key: s => [s.settings.petId, s.pets?.revision, s.persona?.active.avatar, s.pets?.catalog.length, s.settings.reducedMotion, s.settings.funCaptions], render: renderPets },
  { id: 'companion', icon: '🌙', title: '陪伴', intro: '主动陪伴的节奏完全由你决定：选项点选，数字随意填。', key: s => [s.settings, s.companionship?.topics, s.watches, s.pacing], render: renderCompanion },
  { id: 'schedule', icon: '⏰', title: '定时', intro: '你和 TA 设下的提醒。到点后 TA 会主动来找你。', key: s => [s.schedules, s.settings.petId], render: renderSchedules },
  { id: 'privacy', icon: '🛡️', title: '隐私与沙箱', intro: '控制执行器能碰什么，以及哪些内容绝不离开这台电脑。', key: s => [s.settings.sandbox, s.settings.forbiddenPaths, s.settings.captureBlocklist, s.privacy, s.settings.observationEnabled, s.settings.screenCaptureEnabled, s.settings.clipboardEnabled, s.settings.windowTitlesEnabled], render: renderPrivacy },
  { id: 'memory', icon: '📌', title: '记忆', intro: 'TA 眼中的你，和 TA 记住的每一件事。每条都能看来源、纠正或删除。', key: s => [s.memories, s.settings.petId, s.portrait, s.archives?.map(a => a.day + a.createdAt), s.research, s.settings.researchEnabled], render: renderMemories },
  { id: 'diary', icon: '📔', title: '札记', intro: '每天 0 点，TA 会把前一天整理成一份档案；日记是 TA 的感受，不会变成事实。', key: s => [s.diary, s.archives, s.status.journal, s.settings.petId], render: renderDiary },
  { id: 'achievements', icon: '🏆', title: '成就', intro: '相处留下的小徽章。互动成就在桌面小人身上触发，其余只依据真实记录颁发。', key: s => [s.bond, s.identity.name, s.settings.petId, s.pets?.revision], render: renderAchievements },
  { id: 'config', icon: '🔌', title: '连接', intro: '模型、语音与本机执行器。密钥只由桌面进程加密保存。', key: s => [s.provider, s.agent?.cwd, s.agent?.mode, s.settings.ttsEnabled, s.settings.mcpServers, s.agent?.mcp, s.agent?.running, s.settings.executor, s.settings.voiceInputEnabled, s.settings.sttKeySet, s.settings.sttBaseUrl, s.settings.ttsBaseUrl, s.settings.ttsFormat, s.settings.wechatEnabled, s.wechat, s.settings.contextWindow, s.settings.maxOutputTokens, s.settings.modelLimits], render: renderConfig },
];

/** Face of a persona card: its own pixel pet standing still (it wakes up on hover); a letter badge when the card has no sprite. */
function personaFace(host: HTMLElement, p: { name: string; avatar?: string }, s: AppSnapshot) {
  const spec = builtinPet(p.avatar);
  if (!spec) { host.append(iconBadge(p.name.slice(0, 1), 'lg solid')); return () => {}; }
  const face = el('div', 'persona-face'), stage = el('div', 'persona-face-pet');
  face.append(stage); host.append(face);
  const pet = new PixelPet(stage, spec, { left: 0.08, top: 0.02, right: 0.92, bottom: 0.98 });
  let revision = 1;
  const set = (live: boolean) => pet.setState({ expression: live ? 'pleased' : 'neutral', action: live ? 'wave' : 'idle', revision: live ? ++revision : revision, visible: live, reducedMotion: s.settings.reducedMotion, quiet: false });
  set(false);
  face.onmouseenter = () => set(true); face.onmouseleave = () => set(false);
  pageDisposers.push(() => pet.destroy());
  return () => pet.destroy();
}

// ---- 任务 ----
/** ?task= opens one record (previews only). */
let openTaskId = new URLSearchParams(location.search).get('task') || '';
const taskDetails = new Map<string, TaskRunDetail>();
const STATUS_TEXT = { done: '完成', failed: '未完成', cancelled: '已取消' } as const;
const duration = (ms: number) => ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} 秒` : ms < 3600_000 ? `${Math.round(ms / 60_000)} 分钟` : `${(ms / 3600_000).toFixed(1)} 小时`;
function renderTasks(root: HTMLElement, s: AppSnapshot) {
  const running = s.agent?.running || [], history = s.taskHistory || [];
  const now = section('正在进行', running.length ? `${running.length} 个任务在跑，聊天不受影响。` : '现在没有任务在跑。在聊天里让 TA 去做，或输入「/任务 要做的事」。');
  for (const r of running) {
    const row = el('div', 'list-row'), main = el('div', 'row-main');
    main.append(el('strong', '', r.task.slice(0, 160)), el('small', 'row-meta', `开始于 ${clockText(r.startedAt)}`));
    row.append(iconBadge('terminal', 'accent'), main, button('取消', () => void command({ type: 'agent.cancel', id: r.id }), 'btn ghost small'));
    now.append(row);
  }
  const clear = button('清空记录', async () => { if (!confirm('清空任务记录？已经改过的文件不受影响，只是不能再从这里撤销。')) return; const r = await command({ type: 'agent.clearHistory' }); if (r.ok) { taskDetails.clear(); toast('任务记录已清空。'); } }, 'btn ghost small');
  const past = section('做过的事', history.length ? `最近 ${history.length} 件（本机保存，最多 100 件）。点开看详情；撤销只恢复通过文件工具改过的文件，命令行造成的改动撤不回。` : '还没有做过任务。', ...(history.length ? [clear] : []));
  for (const t of history) {
    const item = el('div', 'task-item'); item.classList.toggle('open', t.id === openTaskId);
    const head = button('', () => { openTaskId = openTaskId === t.id ? '' : t.id; root.replaceChildren(); renderTasks(root, s); }, 'task-head');
    const main = el('div', 'row-main');
    const meta = [clockText(t.completedAt), duration(t.durationMs), `${t.toolCount} 次工具`, ...(t.changedFiles ? [`改了 ${t.changedFiles} 个文件${t.undone ? '（已撤销）' : ''}`] : [])];
    main.append(el('strong', '', t.task), el('small', 'row-meta', meta.join(' · ')));
    head.append(el('span', `task-dot ${t.status}`), main, el('span', `pill ${t.status === 'done' ? 'ok' : t.status === 'failed' ? 'warn' : ''}`, STATUS_TEXT[t.status]));
    item.append(head);
    if (t.id === openTaskId) item.append(taskBody(t, root, s));
    past.append(item);
  }
  root.append(now, past);
}
function taskBody(t: TaskRunView, root: HTMLElement, s: AppSnapshot) {
  const body = el('div', 'task-body');
  const detail = taskDetails.get(t.id);
  if (!detail || detail.undone !== t.undone) {
    body.append(el('p', 'hint', '读取中…'));
    void command({ type: 'agent.task', id: t.id }, true).then(r => { if (r.ok && r.data) { taskDetails.set(t.id, r.data as TaskRunDetail); if (openTaskId === t.id) { root.replaceChildren(); renderTasks(root, s); } } else body.replaceChildren(el('p', 'hint', r.error || '没找到这条记录。')); });
    return body;
  }
  const full = el('div', 'task-full'); full.append(el('small', 'row-meta', '交代的任务'), el('p', 'task-text', detail.task));
  const summary = el('div', 'message-text md task-summary'); summary.innerHTML = renderMarkdown(detail.summary || '（没有摘要）');
  body.append(full, el('small', 'row-meta', '执行代理的汇报'), summary);
  const tools = Object.entries(detail.tools).sort((a, b) => b[1] - a[1]);
  if (tools.length) { const chips = el('div', 'chips'); for (const [name, n] of tools) chips.append(el('span', 'pill', `${name} × ${n}`)); body.append(el('small', 'row-meta', '用到的工具'), chips); }
  if (detail.files.length) { const list = el('ul', 'task-files'); for (const f of detail.files.slice(0, 60)) list.append(el('li', '', f)); if (detail.files.length > 60) list.append(el('li', 'hint', `……另外 ${detail.files.length - 60} 个`)); body.append(el('small', 'row-meta', '改过的文件'), list); }
  if (detail.undo) body.append(notice(`${clockText(detail.undo.at)} 已撤销：恢复 ${detail.undo.restored} 个文件${detail.undo.conflicts.length ? `；${detail.undo.conflicts.length} 个之后又被改过，保持原样` : ''}${detail.undo.skipped ? `；${detail.undo.skipped} 个无法恢复` : ''}。`, 'accent'));
  body.append(el('small', 'row-meta', `工作目录：${detail.cwd}`));
  const actions = el('div', 'row wrap');
  if (t.undoable) actions.append(button('撤销这次的改动', async () => { if (!confirm(`把这次任务改过的 ${t.changedFiles} 个文件恢复原样？之后又被改过的文件会保持不动。`)) return; const r = await command({ type: 'agent.undo', runId: detail.runId }); if (r.ok) { taskDetails.delete(t.id); toast('已撤销。'); } }, 'btn ghost small'));
  actions.append(button('再做一次', async () => { const r = await command({ type: 'agent.run', task: detail.task }); if (r.ok) toast('已经重新交给执行代理。'); }, 'btn ghost small'),
    button('复制汇报', () => { void navigator.clipboard.writeText(detail.summary).then(() => toast('已复制。')); }, 'btn ghost small'));
  body.append(actions);
  return body;
}

/** The one way a model endpoint is entered: address, key, model — with 「拉取模型」 listing what the address offers. */
function endpointInputs(kind: EndpointKind, baseUrl: string, modelName: string, keyHint: string, onModelInfo?: (info: ModelInfo | undefined) => void) {
  const url = el('input'); url.value = baseUrl; url.spellcheck = false; url.placeholder = 'https://…/v1';
  const key = el('input'); key.type = 'password'; key.autocomplete = 'off'; key.placeholder = keyHint;
  const model = el('input'); model.value = modelName; model.spellcheck = false;
  const list = el('datalist'); list.id = `models-${kind}-${Math.random().toString(36).slice(2, 8)}`; model.setAttribute('list', list.id);
  const chips = el('div', 'chips model-chips'); chips.hidden = true;
  const fetchBtn = button('拉取模型', async () => {
    if (!url.value.trim()) { toast('先填地址', 'error'); return; }
    fetchBtn.disabled = true; fetchBtn.textContent = '拉取中…';
    const r = await command({ type: 'endpoint.models', kind, baseUrl: url.value.trim(), ...(key.value.trim() ? { apiKey: key.value.trim() } : {}) }, true);
    fetchBtn.disabled = false; fetchBtn.textContent = '拉取模型';
    const data = r.data as { models?: string[]; info?: ModelInfo[] } | undefined, infos = new Map((data?.info || []).map(i => [i.id, i]));
    const models = rankModels(kind, data?.models || []);
    onModelInfo?.(infos.get(model.value));
    model.onchange = () => onModelInfo?.(infos.get(model.value.trim()));
    if (!r.ok || !models.length) { toast(r.error || '没拿到模型列表，请手动填写。', 'error'); return; }
    list.replaceChildren(...models.map(m => { const o = el('option'); o.value = m; return o; }));
    chips.replaceChildren(...models.slice(0, 14).map(m => button(m, () => { model.value = m; onModelInfo?.(infos.get(m)); for (const c of chips.children) c.classList.toggle('on', c.textContent === m); }, `chip small${m === model.value ? ' on' : ''}`)));
    if (models.length > 14) chips.append(el('small', 'row-meta', `共 ${models.length} 个，在模型框里输入可筛选`));
    chips.hidden = false; toast(`拿到 ${models.length} 个模型。`);
  }, 'btn ghost small');
  const modelRow = el('div', 'row model-row'); modelRow.append(model, fetchBtn, list);
  const modelBox = el('div', 'model-box'); modelBox.append(modelRow, chips);
  return { url, key, model, fields: [field(`${ENDPOINT_LABEL[kind]}地址`, url), field('API Key', key), field('模型', modelBox, '可以点「拉取模型」从接口拿可用列表')] };
}

/** 微信：用户自己的个人微信里多一个 TA。只认扫码的人；需要确认的事发到微信回数字；每句话出门前都脱敏。 */
function wechatSection(s: AppSnapshot) {
  const w = s.wechat || { state: 'off' as const }, on = s.settings.wechatEnabled === true;
  const box = section('微信（手机上找 TA）', '扫码后，你的微信里会多一个 TA。离开电脑时，TA 的主动消息、任务结果、提醒和需要你确认的事都会发到微信；在微信里和 TA 说话，就是在和桌面上同一个 TA 聊天（带长期记忆，能派任务、改设置）。');
  const toggleEl = toggle(on, async v => {
    if (v && !confirm('打开微信通道？\n\n· 和 TA 的微信聊天会经过腾讯的服务器。\n· 只有扫码绑定的那个微信号能和 TA 说话，别人发来一律不理。\n· 在微信里 TA 能派任务、改设置；需要你确认的操作会以编号发到微信，不回复就不执行。\n· API Key、密码这类内容发出前仍会自动打码。')) return;
    await command({ type: 'wechat.enable', enabled: v });
  });
  box.append(field('打开微信通道', toggleEl, '默认关闭；只有你能改，「一键隐私锁定」会关掉它'));
  const status = el('div', 'wechat-status');
  const label: Record<string, string> = { off: '已关闭', unbound: '还没绑定', qr: '用手机微信扫下面的码', scanned: '已扫码，请在手机上确认', verify: '请输入手机上显示的数字', connected: '已连接', expired: '登录失效了，需要重新绑定', error: '出错了' };
  status.append(el('strong', '', label[w.state] || w.state));
  const meta: string[] = [];
  if (w.boundAt) meta.push(`绑定于 ${clockText(w.boundAt)}`);
  if (w.lastInboundAt) meta.push(`你上次在微信说话：${relativeTime(w.lastInboundAt)}`);
  if (w.replyWindowUntil) meta.push(Date.parse(w.replyWindowUntil) > Date.now() ? `TA 能主动发消息到 ${clockText(w.replyWindowUntil)}（腾讯的规则：你发一句，窗口就续上）` : '回复窗口已过：在微信里给 TA 发一句，TA 才能继续给你发消息');
  if (w.sent || w.received) meta.push(`收 ${w.received || 0} 条 · 发 ${w.sent || 0} 条`);
  if (meta.length) status.append(el('small', 'row-meta', meta.join(' · ')));
  if (w.error) status.append(notice(w.error, 'warn'));
  if (w.qr && (w.state === 'qr' || w.state === 'scanned')) {
    const q = qrcode(0, 'M'); q.addData(w.qr); q.make();
    const img = el('div', 'wechat-qr'); img.innerHTML = q.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
    status.append(img, el('small', 'hint', '只有扫这个码的人能和 TA 说话。'));
  }
  if (w.state === 'verify') {
    const code = el('input'); code.inputMode = 'numeric'; code.maxLength = 12; code.placeholder = '手机上的数字';
    const row = el('div', 'row'); row.append(code, button('提交', () => void command({ type: 'wechat.verify', code: code.value.trim() }), 'btn primary small'));
    status.append(row);
  }
  const actions = el('div', 'row wrap');
  if (on && (w.state === 'unbound' || w.state === 'expired' || w.state === 'error')) actions.append(button(w.state === 'unbound' ? '扫码绑定微信' : '重新绑定', async () => { const r = await command({ type: 'wechat.login' }); if (!r.ok) toast(r.error || '没拿到二维码', 'error'); }, 'btn primary'));
  if (w.boundAt) actions.append(button('解除绑定', async () => { if (confirm('解除绑定？之后微信里的 TA 就收不到也发不出消息了。')) await command({ type: 'wechat.logout' }); }, 'btn ghost'));
  if (on) box.append(status);
  if (actions.childElementCount) box.append(actions);
  box.append(el('p', 'hint', '用的是腾讯官方的 iLink 机器人接口（和 OpenClaw 的微信插件同一个），不是外挂；接口没有公开文档，腾讯改动时可能需要更新。绑定信息用 Windows DPAPI 加密保存在本机。'));
  return box;
}

/** 语音输入（按住说话）：识别接口的配置与开关。只有用户能改；音频只发给这里填的接口。 */
function voiceInputSection(s: AppSnapshot) {
  const st = s.settings;
  const box = section('语音输入（按住说话）', '按住聊天框旁的麦克风说话，松开后交给下面的语音识别接口转成文字，填进输入框，你确认后再发。按下才开麦，松开立刻关，最长 60 秒；录音不保存。');
  const form = el('form', 'form-grid');
  const ep = endpointInputs('stt', st.sttBaseUrl || '', st.sttModel || '', st.sttKeySet ? '已加密保存；留空保留原密钥' : '填入密钥（与语音输出 / 对话模型同一地址时可留空）');
  const format = select(st.sttFormat || 'openai-transcriptions', STT_FORMATS, () => {});
  const lang = el('input'); lang.value = st.sttLanguage || 'zh'; lang.maxLength = 8; lang.placeholder = 'zh';
  const enabled = toggle(!!st.voiceInputEnabled, async v => {
    if (v && !confirm(`打开后，你按住麦克风说的话会发送到：\n${st.sttBaseUrl || '（还没填地址）'}\n\n只在你按住时录音，录音不保存。确定打开？`)) { void command({ type: 'stt.configure', voiceInputEnabled: false }); return; }
    const r = await command({ type: 'stt.configure', voiceInputEnabled: v }); if (r.ok && v) toast('已打开，聊天框旁边多了一个麦克风。');
  });
  const presets = el('div', 'row wrap'); presets.append(el('small', 'hint', '快速填入：'));
  for (const p of STT_PRESETS) presets.append(button(p.label, () => { ep.url.value = p.url; ep.model.value = p.model; format.value = p.format; }, 'chip small'));
  presets.append(button('同语音输出', () => { ep.url.value = st.ttsBaseUrl || ''; }, 'chip small'), button('同对话模型', () => { ep.url.value = s.provider.baseUrl; format.value = 'chat-input-audio'; }, 'chip small'));
  const save = el('button', 'btn primary', '保存语音输入'); save.type = 'submit';
  form.append(field('打开按住说话', enabled, '默认关闭；AI 改不了这个开关'), field('请求格式', format, '大多数服务用第一种；会听音频的多模态对话模型选第二种'), ...ep.fields, field('语言', lang, 'zh 中文、en 英文；留空让接口自己判断'), presets, save);
  form.onsubmit = async event => {
    event.preventDefault(); const k = ep.key.value.trim(); ep.key.value = '';
    const r = await command({ type: 'stt.configure', sttBaseUrl: ep.url.value.trim(), sttModel: ep.model.value.trim(), sttFormat: format.value as 'openai-transcriptions' | 'chat-input-audio', sttLanguage: lang.value.trim(), ...(k ? { sttApiKey: k } : {}) });
    if (r.ok) toast('语音输入配置已保存。');
  };
  box.append(form, el('p', 'hint', '密钥只交给桌面进程，用 Windows DPAPI 加密保存。地址只能是 HTTPS 或本机。'));
  return box;
}

/** 一键添加：常用 MCP 服务的模板卡片，点开填文件夹 / 令牌即可。 */
function presetGallery(existing: string[]) {
  const wrap = el('div', 'preset-wrap');
  wrap.append(el('small', 'row-meta', '常用服务 · 一键添加'));
  const grid = el('div', 'preset-grid'), form = el('div', 'preset-form'); form.hidden = true;
  let open = '';
  for (const p of MCP_PRESETS) {
    const added = existing.some(e => (p.url && e === p.url) || (!p.url && e.startsWith(`${p.command} ${(p.args || []).join(' ')}`)) && !p.folder);
    const card = button('', () => { open = open === p.id ? '' : p.id; for (const c of grid.children) c.classList.toggle('active', (c as HTMLElement).dataset.id === open); showForm(open ? p : undefined); }, 'preset-card selectable'); card.dataset.id = p.id;
    card.append(el('span', 'preset-cat', p.category), el('strong', '', p.title), el('small', '', p.description));
    if (added) card.append(el('span', 'pill ok', '已添加'));
    grid.append(card);
  }
  function showForm(p?: McpPreset) {
    form.replaceChildren(); form.hidden = !p; if (!p) return;
    const values: Record<string, HTMLInputElement> = {};
    let folder = '';
    form.append(el('strong', '', `添加「${p.title}」`), el('p', 'hint', p.url ? `远程服务：${p.url}` : `本机运行：${p.command} ${(p.args || []).join(' ')}${p.folder ? ' <文件夹>' : ''}`));
    if (p.folder) {
      const shown = el('span', 'row-meta', '还没选'), pick = button('选择文件夹…', async () => { const r = await command({ type: 'mcp.pickFolder' }, true); const path = (r.data as { path?: string } | undefined)?.path; if (path) { folder = path; shown.textContent = path; } }, 'btn ghost small');
      pick.prepend(svgIcon('folder', 15)!);
      const row = el('div', 'row wrap'); row.append(pick, shown);
      form.append(field(p.folder.label, row, p.folder.hint));
    }
    for (const sec of p.secrets || []) {
      const input = el('input'); input.type = sec.path ? 'text' : 'password'; input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = sec.path ? 'C:\\…\\xxx.json' : '粘贴到这里，只会加密保存在本机';
      values[sec.key] = input; form.append(field(sec.label, input, sec.hint));
    }
    if (p.setup) form.append(notice(p.setup, 'accent'));
    form.append(el('p', 'hint', '密钥由系统加密保存，设置里只记名称；执行代理第一次用这个服务前会按你的沙箱档位询问。'));
    const add = button('添加', async () => {
      if (p.folder && !folder) { toast('先选一个文件夹', 'error'); return; }
      const secrets = Object.fromEntries(Object.entries(values).map(([k, i]) => [k, i.value]).filter(([, v]) => v.trim()));
      if ((p.secrets || []).some(sec => !secrets[sec.key]) && !confirm('还有密钥没填，这个服务可能连不上。先加进去，之后再在下面补？')) return;
      const r = await command({ type: 'mcp.addPreset', id: p.id, ...(folder ? { folder } : {}), ...(Object.keys(secrets).length ? { secrets } : {}) });
      for (const i of Object.values(values)) i.value = '';
      if (r.ok) toast(`已添加「${p.title}」，执行任务时会自动连接。`);
    }, 'btn primary small');
    const actions = el('div', 'row wrap'); actions.append(add, el('small', 'row-meta selectable-text', `说明：${p.docs}`)); form.append(actions);
  }
  wrap.append(grid, form);
  return wrap;
}

function renderPersonas(root: HTMLElement, s: AppSnapshot) {
  const list = s.persona?.list || [], active = s.persona?.active, days = s.bond?.daysTogether || 0;
  const grid = el('div', 'persona-grid');
  for (const p of list) {
    const card = el('article', 'persona-card selectable'); card.classList.toggle('active', p.id === active?.id); card.dataset.id = p.id;
    const top = el('div', 'persona-top'), names = el('div', 'persona-names'), face = el('div', 'persona-face-wrap');
    names.append(el('strong', '', p.name), el('small', '', `${p.pronoun} · ${p.relationship || (p.builtin ? '内置角色' : '自定义角色')}`));
    personaFace(face, p, s);
    top.append(face, names);
    card.append(top, el('p', 'persona-tagline', p.tagline || '（还没有简介）'));
    const badges = personaBadges(p, days); if (badges.length) { const row = el('div', 'persona-badges'); row.append(...badges); card.append(row); }
    const actions = el('div', 'row');
    if (p.id !== active?.id) actions.append(button('选择', () => void command({ type: 'persona.select', id: p.id }), 'btn primary small'));
    else actions.append(el('span', 'pill accent', '当前角色'));
    const edit = button(p.builtin ? '复制并修改' : '编辑', () => openPersonaEditor(root, s, p), 'btn ghost small'); edit.dataset.action = 'edit';
    actions.append(edit, button('导出', () => void command({ type: 'persona.export', id: p.id }), 'btn ghost small'));
    if (!p.builtin) actions.append(button('删除', async () => { if (confirm(`删除角色卡「${p.name}」？聊天记录和记忆会保留。`)) await command({ type: 'persona.delete', id: p.id }); }, 'btn danger small'));
    card.append(actions); grid.append(card);
  }
  const create = el('button', 'persona-card selectable dashed create'); create.type = 'button';
  create.append(iconBadge('+', 'lg accent'), el('strong', '', '新建角色卡'), el('small', '', '从空白开始，或用一句话让 AI 帮你起草'));
  create.onclick = () => openPersonaEditor(root, s); grid.append(create);
  const tools = section('角色卡文件', '角色卡只决定性格和说话方式。隐私守则、安静请求和 JSON 格式等通用规则始终生效，不受角色卡影响。');
  const guide = guidePanel(); guide.hidden = true;
  const row = el('div', 'row wrap');
  row.append(button('导入角色卡文件…', async () => { const text = await readFileText('.json,application/json'); if (text) { const r = await command({ type: 'persona.import', text }); if (r.ok) toast('角色卡已导入，可以在列表里选择它。'); } }, 'btn ghost'),
    button('写卡指南', () => { guide.hidden = !guide.hidden; }, 'btn ghost'));
  tools.append(row, guide);
  root.append(grid, tools);
}

function renderPets(root: HTMLElement, s: AppSnapshot) {
  const current = wantedPet(s), catalog = s.pets?.catalog?.length ? s.pets.catalog : builtinPixelPets.map(p => ({ id: p.id, name: p.name, description: p.description, builtin: true }));
  const grid = el('div', 'pet-grid');
  for (const entry of catalog) {
    const card = el('button', 'pet-card selectable'); card.type = 'button'; card.classList.toggle('active', entry.id === current);
    const stage = el('div', 'pet-card-stage'); card.append(stage, el('strong', '', entry.name), el('small', '', entry.description || (entry.builtin ? '内置小人' : '自定义小人')));
    if (!entry.builtin) card.append(el('span', 'pill accent', '自定义'));
    card.onclick = () => void command({ type: 'pet.select', id: entry.id });
    grid.append(card);
    // Previews animate only while hovered, keeping a dozen canvases cheap.
    const generation = pageGeneration;
    void loadPet(entry.id, s.pets?.revision || 0).then(spec => {
      if (generation !== pageGeneration) return;
      const preview = new PixelPet(stage, spec); let revision = 1;
      const set = (visible: boolean) => preview.setState({ expression: visible ? 'pleased' : 'neutral', action: visible ? 'wave' : 'idle', revision: visible ? ++revision : revision, visible, reducedMotion: s.settings.reducedMotion, quiet: false });
      set(false); card.onmouseenter = card.onfocus = () => set(true); card.onmouseleave = card.onblur = () => set(false);
      pageDisposers.push(() => preview.destroy());
    });
  }
  const custom = section('自己做一个小人', '小人是一份 JSON 像素图（16–64 像素见方），可以手画，也可以让 AI 按配套 skill 生成。');
  const steps = el('ol', 'steps');
  for (const line of ['在仓库 skills/galagent-pixel-pet/ 找到 SKILL.md 和 template.json，交给你常用的 AI（或自己照着改）', '用 scripts/pixel-pet/validate.mjs 校验、preview.mjs 生成预览图', '点下面「导入小人文件」，或直接把 .json 放进小人文件夹（自动识别）']) steps.append(el('li', '', line));
  const row = el('div', 'row wrap');
  row.append(button('导入小人文件…', async () => { const text = await readFileText('.json,application/json'); if (text) { const r = await command({ type: 'pet.import', text }); if (r.ok) toast('小人导入成功！'); } }, 'btn primary'), button('打开小人文件夹', () => void command({ type: 'pet.openFolder' }), 'btn ghost'));
  if (s.settings.petId) row.append(button('跟随角色卡默认小人', () => void command({ type: 'pet.select', id: '' }), 'btn ghost'));
  custom.append(steps, row);
  const own = catalog.filter(p => !p.builtin);
  if (own.length) {
    const mine = section('我的小人', `${own.length} 个自定义小人`);
    for (const p of own) { const r = el('div', 'list-row'), main = el('div', 'row-main'); main.append(el('strong', '', p.name), el('small', 'row-meta', p.description || '自定义小人')); r.append(iconBadge('🐾', 'accent'), main, button('删除', async () => { if (confirm(`删除自定义小人「${p.name}」？`)) await command({ type: 'pet.delete', id: p.id }); }, 'btn danger small')); mine.append(r); }
    root.append(grid, custom, mine);
  } else root.append(grid, custom);
  const size = section('大小与动效');
  size.append(field('桌宠缩放', numberInput(s.settings.petScale, v => void settings({ petScale: v }), { step: 0.1, unit: '倍' }), '0.3 – 4 倍'),
    field('减少动态效果', toggle(s.settings.reducedMotion, v => void settings({ reducedMotion: v }))), field('头顶小词条与彩蛋', toggle(s.settings.funCaptions !== false, v => void settings({ funCaptions: v })), '发呆时偶尔冒出的小状态、节日问候'));
  root.append(size);
}

function renderCompanion(root: HTMLElement, s: AppSnapshot) {
  const st = s.settings;
  const modes = section('今天怎样陪你', '模式只改变 TA 主动的程度；你随时都可以找 TA 聊天。');
  const choices = el('div', 'segmented'); choices.setAttribute('role', 'radiogroup');
  for (const mode of companionModes) { const b = button('', () => void settings({ companionMode: mode.value }), 'segment selectable'); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String((st.companionMode || 'daily') === mode.value)); b.append(el('strong', '', mode.label), el('small', '', mode.description)); choices.append(b); }
  modes.append(choices);
  const pace = section('主动开口的节奏', '数字可以随便填，程序只会把明显不合理的值收拢到安全范围。');
  pace.append(
    field('允许主动开口', toggle(st.initiativeEnabled, v => void settings({ initiativeEnabled: v }))),
    field('两次主动的最短间隔', numberInput(st.proactiveIntervalMinutes, v => void settings({ proactiveIntervalMinutes: v }), { unit: '分钟' })),
    field('每小时最多', numberInput(st.proactiveHourlyLimit, v => void settings({ proactiveHourlyLimit: v }), { step: 1, unit: '次' }), '0 = 不主动'),
    field('每天最多', numberInput(st.proactiveDailyLimit, v => void settings({ proactiveDailyLimit: v }), { step: 1, unit: '次' })),
    field('注意力心跳', numberInput(st.heartbeatSeconds, v => void settings({ heartbeatSeconds: v }), { unit: '秒' }), '后台多久看一眼桌面变化；有事件时会立即判断'),
    field('久未回应提醒', numberInput(st.unansweredMinutes, v => void settings({ unansweredMinutes: v }), { unit: '分钟' }), 'TA 的话多久没人理会再问一次'),
    field('重逢问候', numberInput(st.reunionHours, v => void settings({ reunionHours: v }), { unit: '小时' }), '离开多久后再见面会打招呼'),
    field('自动学分寸', toggle(st.adaptivePacing !== false, v => void settings({ adaptivePacing: v })), '同一类话题连着两次没人理，TA 会先歇一阵（2 小时起，最长 3 天）；最近多数没回应时把间隔拉长到 2–3 倍。只会更安静，不会超过上面的上限；你一回应就恢复'),
  );
  const pv = s.pacing;
  if (pv?.enabled && (pv.factor > 1 || pv.paused.length)) {
    const lines: string[] = [];
    if (pv.factor > 1) lines.push(`最近 ${pv.samples} 次主动开口里约 ${Math.round(pv.ignoreRate * 100)}% 没被回应，间隔暂时拉长到 ${pv.factor} 倍。`);
    for (const p of pv.paused) lines.push(`「${topicLabels[p.topic]}」连续 ${p.ignored} 次没回应，先歇到 ${clockText(new Date(p.until).toISOString())}。`);
    pace.append(notice(lines.join(' '), 'accent', button('现在就恢复', async () => { const r = await command({ type: 'pacing.reset' }); if (r.ok) toast('已恢复，TA 会按你设的节奏来。'); }, 'btn ghost small')));
  }
  const quiet = section('免打扰时段', '这段时间里 TA 不主动开口，定时提醒也会等到结束后再响。');
  const q = st.quietHours || { enabled: false, start: '23:00', end: '08:00' };
  const time = (value: string, key: 'start' | 'end') => { const t = el('input'); t.type = 'time'; t.value = value; t.onchange = () => void settings({ quietHours: { [key]: t.value } }); return t; };
  quiet.append(field('启用', toggle(q.enabled, v => void settings({ quietHours: { enabled: v } }))), field('开始', time(q.start, 'start')), field('结束', time(q.end, 'end')),
    field('临时安静', select(st.quietUntil > Date.now() ? 'now' : 'none', [st.quietUntil > Date.now() ? ['now', `安静中，到 ${new Date(st.quietUntil).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`] : ['none', '不安静'], ['30', '安静 30 分钟'], ['60', '安静 1 小时'], ['180', '安静 3 小时'], ...(st.quietUntil > Date.now() ? [['0', '现在恢复主动'] as [string, string]] : [])] as [string, string][], v => { if (v === 'now' || v === 'none') return; void settings({ quietUntil: v === '0' ? 0 : Date.now() + Number(v) * 60_000 }); })));
  const reset = button('恢复全部默认', async () => { const r = await command({ type: 'initiative.resetFeedback' }); if (r.ok) toast('已恢复默认话题偏好。'); }, 'btn ghost small');
  const topics = section('TA 可以因为什么来找你', '关掉的话题，后台注意力代理不会再因此叫醒 TA。', reset);
  const prefs = s.companionship?.topics || {};
  const grid = el('div', 'toggle-grid');
  for (const [topic, label] of Object.entries(topicLabels)) {
    const on = prefs[topic as keyof typeof prefs] !== 'mute';
    grid.append(field(label, toggle(on, v => void command({ type: 'initiative.topic', topic: topic as keyof typeof topicLabels, enabled: v }), label)));
  }
  topics.append(grid);
  const desk = section('桌面上的 TA');
  const deskActions = el('div', 'row wrap');
  deskActions.append(button('出去溜达一圈', () => void command({ type: 'pet.roam', active: true }), 'btn ghost small'), button('回到屏幕角落', () => void command({ type: 'shell.resetPosition' }), 'btn ghost small'));
  desk.append(
    field('自在漫步', toggle(st.roamingEnabled !== false, v => void settings({ roamingEnabled: v })), '鼠标靠近、对话或睡着时会停下'),
    field('漫步速度', numberInput(st.roamSpeed, v => void settings({ roamSpeed: v }), { step: 0.1, unit: '倍' })),
    field('你离开多久后打盹', numberInput(st.idleSleepMinutes, v => void settings({ idleSleepMinutes: v }), { unit: '分钟' }), '0 = 不打盹（需开启桌面观察）'),
    field('气泡停留', numberInput(st.bubbleSeconds, v => void settings({ bubbleSeconds: v }), { unit: '秒' }), '另按字数自动加长'),
    field('偶尔的小调皮', toggle(st.mischiefEnabled, v => void settings({ mischiefEnabled: v })), '只影响表情和小动作'),
    field('自动朗读', toggle(!!st.ttsEnabled, v => void settings({ ttsEnabled: v })), '需在「连接」页配置语音'),
    deskActions,
  );
  const bedtime = el('input'); bedtime.type = 'time'; bedtime.value = st.goodnightAt || '23:30'; bedtime.onchange = () => void settings({ goodnightAt: bedtime.value });
  const lively = section('像真人一样', '这些都受上面的节奏、免打扰时段和陪伴模式约束；分享、早晚安和旧事重提也可以在下面的话题里单独关掉。');
  lively.append(
    field('分几条发消息', toggle(st.splitReplies !== false, v => void settings({ splitReplies: v })), '闲聊时一段话拆成 2–3 条，像在打字'),
    field('偶尔补一句', toggle(st.afterthoughts !== false, v => void settings({ afterthoughts: v })), '回复后一两分钟“啊对了…”；你先开口就不补'),
    field('心情与精力', toggle(st.moodEnabled !== false, v => void settings({ moodEnabled: v })), '深夜会困、被冷落会委屈，摸摸头就好'),
    field('自己的小日程', toggle(st.routineEnabled !== false, v => void settings({ routineEnabled: v })), '头顶显示 TA 在做什么，可在角色卡里自定义'),
    field('头顶小嘀咕', toggle(st.murmursEnabled !== false, v => void settings({ murmursEnabled: v })), '按前台应用类型冒一句，不进聊天记录（需开启桌面观察）'),
    field('每天分享新鲜事', numberInput(st.shareDailyLimit ?? 1, v => void settings({ shareDailyLimit: v }), { step: 1, unit: '次' }), '会上网查你感兴趣的东西；0 = 不分享'),
    field('旧事重提', numberInput(st.recallEveryDays ?? 3, v => void settings({ recallEveryDays: v }), { unit: '天一次' }), '冷不丁问起你几天前说过的事；0 = 关闭'),
    field('道晚安的时间', bedtime, '过了这个点你还在，TA 会说晚安然后睡着'),
  );
  const watch = section('TA 在留意的事', '告诉 TA 一件事，TA 会在合适的时候帮你看一眼。');
  const items = s.watches || [];
  if (!items.length) watch.append(emptyPet(s, '现在没有在留意的事。', 'idle', undefined, true));
  for (const w of items) { const row = el('div', 'list-row'), main = el('div', 'row-main'); main.append(el('strong', '', w.title), ...(w.condition ? [el('small', 'row-meta', w.condition)] : [])); row.append(iconBadge('👀', 'accent'), main, button('移除', () => void command({ type: 'watch.dismiss', id: w.id }), 'btn ghost small')); watch.append(row); }
  const form = el('form', 'inline-form'); const input = el('input'); input.placeholder = '比如：下午那个快递到了没'; input.maxLength = 120; const add = el('button', 'btn primary', '添加'); add.type = 'submit'; form.append(input, add);
  form.onsubmit = async event => { event.preventDefault(); if (input.value.trim() && (await command({ type: 'watch.add', title: input.value.trim() })).ok) input.value = ''; };
  watch.append(form);
  root.append(modes, pace, lively, quiet, topics, desk, watch);
}

const repeatText = (minutes: number) => minutes >= 1440 && minutes % 1440 === 0 ? `每 ${minutes / 1440} 天` : minutes >= 60 && minutes % 60 === 0 ? `每 ${minutes / 60} 小时` : `每 ${minutes} 分钟`;
function renderSchedules(root: HTMLElement, s: AppSnapshot) {
  const add = section('新建提醒', 'TA 到点会醒来，用自己的口吻提醒你。你也可以直接在聊天里说“半小时后提醒我…”。');
  const form = el('form', 'schedule-form');
  const note = el('input'); note.placeholder = '要提醒什么？'; note.maxLength = 300; note.required = true;
  const mode = select<'in' | 'at'>('in', [['in', '多久以后'], ['at', '具体时间']], v => { minutes.hidden = v !== 'in'; at.hidden = v !== 'at'; });
  const minutes = numberInput(30, () => {}, { unit: '分钟后' }); const at = el('input'); at.type = 'datetime-local'; at.hidden = true;
  const repeat = select('0', [['0', '不重复'], ['30', '每 30 分钟'], ['60', '每小时'], ['1440', '每天'], ['10080', '每周'], ['custom', '自定义…']], v => { custom.hidden = v !== 'custom'; });
  const custom = numberInput(90, () => {}, { unit: '分钟一次' }); custom.hidden = true;
  const submit = el('button', 'btn primary', '设定'); submit.type = 'submit';
  const when = el('div', 'row wrap'); when.append(mode, minutes, at, repeat, custom);
  form.append(note, when, submit);
  form.onsubmit = async event => {
    event.preventDefault();
    const inMinutes = Number(minutes.querySelector('input')!.value), repeatMinutes = repeat.value === 'custom' ? Number(custom.querySelector('input')!.value) : Number(repeat.value);
    const r = await command({ type: 'schedule.add', note: note.value.trim(), ...(mode.value === 'in' ? { inMinutes } : { at: at.value }), ...(repeatMinutes > 0 ? { repeatMinutes } : {}) });
    if (r.ok) { note.value = ''; toast('提醒已设定。'); }
  };
  add.append(form);
  const items = s.schedules || [];
  const list = section('已设定的提醒', items.length ? `${items.length} 个提醒，按时间先后排列` : '');
  if (!items.length) list.append(emptyPet(s, '还没有提醒。TA 也会在聊天中自己约定下次来找你的时间。', 'sleep'));
  for (const item of items) {
    const row = el('div', 'list-row'), main = el('div', 'row-main'), meta = el('div', 'row-meta');
    meta.append(el('span', '', `${clockText(item.dueAt)}（${relativeTime(item.dueAt)}）`), ...(item.repeatMinutes ? [el('span', 'pill', repeatText(item.repeatMinutes))] : []), el('span', `pill ${item.createdBy === 'user' ? '' : 'accent'}`, item.createdBy === 'user' ? '你设的' : 'TA 自己约的'));
    main.append(el('strong', '', item.note), meta);
    row.append(iconBadge(item.createdBy === 'user' ? '你' : 'TA', 'accent'), main, button('取消', () => void command({ type: 'schedule.cancel', id: item.id }), 'btn ghost small'));
    list.append(row);
  }
  root.append(add, list);
}

function renderPrivacy(root: HTMLElement, s: AppSnapshot) {
  const box = s.settings.sandbox!;
  const level = section('执行器沙箱级别', 'GalAgent 的本机工具（读写文件、Shell、联网）受这里约束。这是应用内保护，不等同于操作系统沙箱。');
  const seg = el('div', 'segmented'); seg.setAttribute('role', 'radiogroup');
  for (const [value, title, text] of [['strict', '严格', '只读工作目录 · 无 Shell · 无联网 · 隐藏个人信息'], ['standard', '标准（推荐）', '全盘可读 · 只在工作目录写 · 命令先问你 · 公网搜索'], ['open', '宽松', '全盘读写（受保护目录除外）· 命令不再询问'], ['full', '完全放开', '最高权限：再加内网访问、可读凭据文件、MCP 免询问']] as const) {
    const b = button('', () => { if (value === 'full' && box.level !== 'full' && !confirm('完全放开后，执行器可以不经询问运行任何命令、读写任何文件（包括 .ssh、.env 等凭据）、访问内网和本机服务。\n\n网页或文件里的恶意指令也可能借此操作你的电脑。只在你信任当前任务时使用，用完可一键切回。\n\n确定切换？')) return; void sandbox(s, { level: value }); }, `segment selectable${value === 'full' ? ' danger' : ''}`); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(box.level === value)); b.append(el('strong', '', title), el('small', '', text)); seg.append(b);
  }
  level.append(seg,
    field('文件范围', select(box.fileScope, [['workspace-read', '只读工作目录'], ['workspace', '工作目录内读写'], ['read-anywhere', '任意位置可读，只在工作目录写'], ['anywhere', '不限制（受保护目录除外）']], v => void sandbox(s, { fileScope: v }))),
    field('允许 Shell 命令', toggle(box.shell, v => void sandbox(s, { shell: v })), '脚本可以绕过文件检查'),
    field('运行命令前问我', toggle(box.shellConfirm !== false, v => void sandbox(s, { shellConfirm: v })), '每条命令先在聊天页给你看，可选“本任务都允许”'),
    field('允许联网工具', toggle(box.network, v => void sandbox(s, { network: v })), '网页搜索与读网页'),
    field('允许访问内网和本机服务', toggle(!!box.lanAccess, v => void sandbox(s, { lanAccess: v })), '路由器、NAS、localhost 开发服务等；默认拒绝'),
    field('允许读写凭据文件', toggle(!!box.credentialFiles, v => void sandbox(s, { credentialFiles: v })), '.ssh、.env、密钥文件等；GalAgent 自己的密钥始终不可读'),
    field('只允许访问这些域名', linesArea(box.allowedDomains, v => void sandbox(s, { allowedDomains: v }), 3, '每行一个，如 github.com；留空不限'), '', 'field wide'),
    field('禁止访问的文件夹', linesArea(s.settings.forbiddenPaths || [], v => void settings({ forbiddenPaths: v }), 3, '每行一个路径'), '设置后 Shell 自动停用；修改会中止进行中的任务', 'field wide'),
  );
  const ai = section('AI 管理权限', `${s.persona?.active.name || 'TA'} 可以在聊天里替你改 GalAgent 的设置、派发执行任务、管理要留意的事。这里决定放宽隐私或权限的改动要不要先问你。`);
  const aiSeg = el('div', 'segmented'); aiSeg.setAttribute('role', 'radiogroup');
  for (const [value, title, text] of [['confirm', '先问我（推荐）', '普通设置直接改；打开观察、提高沙箱、关闭脱敏、接入 MCP 等放宽的改动，先在聊天里请你点一下同意'], ['full', '完全控制', 'TA 可以直接改全部设置，包括隐私与沙箱；密钥仍只能你自己填']] as const) {
    const b = button('', () => { const now = s.settings.aiControl || 'confirm'; if (value === now) return; if (value === 'full' && !confirm('完全控制后，TA 可以不经你确认就打开截屏、提高沙箱档位、关闭脱敏等。\n\n聊天里来自网页或文件的内容也可能诱导 TA 这么做。确定吗？')) return; void settings({ aiControl: value }); }, `segment selectable${value === 'full' ? ' danger' : ''}`);
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String((s.settings.aiControl || 'confirm') === value)); b.append(el('strong', '', title), el('small', '', text)); aiSeg.append(b);
  }
  ai.append(aiSeg, el('p', 'hint', '这个开关只有你能改，TA 改不了它；API Key、MCP 密钥等也只能你自己填。'));
  const out = section('防外泄', '发给模型、语音服务和联网工具的内容会先经过这里。只在本机替换，不影响本地记录。');
  out.append(
    field('隐藏密钥、令牌与密码', toggle(box.redactSecrets, v => void sandbox(s, { redactSecrets: v })), 'API Key、私钥、JWT、“密码：xxx” 等'),
    field('隐藏个人信息', toggle(box.redactPersonal, v => void sandbox(s, { redactPersonal: v })), '身份证号、银行卡号、手机号、邮箱'),
    field('自定义敏感词', linesArea(box.sensitiveWords, v => void sandbox(s, { sensitiveWords: v }), 3, '每行一个：项目代号、客户名、地址…'), '出现即替换为〔已隐藏〕', 'field wide'),
    el('p', 'hint', box.credentialFiles ? '已允许工具读写凭据文件（.ssh、.env、密钥等）；GalAgent 自己的密钥与数据目录始终不可访问；带敏感内容的网址仍会被拦截。' : '凭据文件（.ssh、.aws、.env、*.pem、*.kdbx、浏览器登录数据）不会被工具读取，GalAgent 自己的密钥任何档位都不可访问；带敏感内容的网址会被直接拦截。'),
  );
  const eyes = section('桌面观察', '默认全部关闭。截图原图不落盘，只保留文字摘要；黑名单应用在前台时不截屏。');
  eyes.append(
    field('允许桌面观察', toggle(s.settings.observationEnabled, v => void settings({ observationEnabled: v })), '前台应用名、空闲时长'),
    field('窗口标题', toggle(s.settings.windowTitlesEnabled, v => void settings({ windowTitlesEnabled: v }))),
    field('截屏（画面变化时）', toggle(s.settings.screenCaptureEnabled, v => void settings({ screenCaptureEnabled: v }))),
    field('截屏最短间隔', numberInput(s.settings.screenIntervalSeconds, v => void settings({ screenIntervalSeconds: v }), { unit: '秒' }), '不低于 60 秒'),
    field('剪贴板（最近 50 条）', toggle(s.settings.clipboardEnabled, v => void settings({ clipboardEnabled: v })), '标记为敏感的剪贴板内容会被跳过'),
    field('截屏黑名单', linesArea(s.settings.captureBlocklist, v => void settings({ captureBlocklist: v }), 4, '应用名或窗口标题关键词'), '', 'field wide'),
  );
  const lockdown = button('一键隐私锁定', async () => { const r = await command({ type: 'privacy.lockdown' }); if (r.ok) toast('已停止观察、中止任务并切换到严格沙箱。'); }, 'btn danger solid small');
  const audit = section('今日防护记录', '只记录类别和次数，从不保存被隐藏的内容。', lockdown);
  const stats = el('div', 'stat-row'); const v = s.privacy || { redactedToday: 0, blockedToday: 0, recent: [] };
  for (const [n, label] of [[v.redactedToday, '处隐藏'], [v.blockedToday, '次拦截']] as const) { const stat = el('div', 'tile stat'); stat.append(el('strong', '', String(n)), el('small', '', label)); stats.append(stat); }
  audit.append(stats);
  const names: Record<string, string> = { 'api-key': '密钥', 'private-key': '私钥', jwt: '令牌', bearer: '令牌', credential: '口令', 'id-card': '身份证', 'bank-card': '银行卡', phone: '手机号', email: '邮箱', custom: '敏感词', domain: '域名不在白名单', 'network-off': '联网已关闭' };
  const channels: Record<string, string> = { chat: '聊天', initiative: '主动开口', background: '后台整理', executor: '执行器', 'executor-fetch': '执行器联网', tts: '语音', fetch: '联网' };
  for (const e of v.recent.slice(0, 12)) { const row = el('div', 'list-row compact'); row.append(el('time', '', clockText(e.at)), el('span', `pill ${e.action === 'blocked' ? 'warn' : 'accent'}`, e.action === 'blocked' ? '拦截' : '隐藏'), el('span', 'spacer', `${channels[e.channel] || e.channel} · ${e.kinds.map(k => names[k] || k).join('、')} ×${e.count}`)); audit.append(row); }
  if (v.recent.length) { const row = el('div', 'row'); row.append(button('清空记录', () => void command({ type: 'privacy.clearAudit' }), 'btn ghost small')); audit.append(row); }
  root.append(level, ai, out, eyes, audit);
}

function renderMemories(root: HTMLElement, s: AppSnapshot) {
  root.append(profileSection(s), researchSection(s));
  const add = section('让 TA 记住一件事', '写下来的事会成为 TA 的长期记忆；不确定的事 TA 不会当真。');
  const form = el('form', 'inline-form'); const area = el('textarea'); area.rows = 2; area.maxLength = 1500; area.placeholder = '有一件事，希望 TA 记住…'; const save = el('button', 'btn primary', '记住'); save.type = 'submit'; form.append(area, save);
  form.onsubmit = async event => { event.preventDefault(); if (area.value.trim() && (await command({ type: 'memory.remember', text: area.value.trim() })).ok) area.value = ''; };
  add.append(form);
  const valid = s.memories.filter(x => x.valid);
  if (!valid.length) { const empty = section('TA 记住的事'); empty.append(emptyPet(s, '还没有记忆。慢慢来，我们有时间。', 'think')); root.append(add, empty); return; }
  root.append(add);
  const groups = groupMemories(valid);
  for (const g of PROFILE_GROUPS) {
    const items = groups[g.id]; if (!items.length) continue;
    const box = section(g.title, `${g.hint} · ${items.length} 条`);
    for (const item of items) box.append(memoryRow(item));
    root.append(box);
  }
  const feelings = valid.filter(m => m.kind === 'reflection');
  if (feelings.length) { const box = section('TA 自己的感受', '这些是 TA 的心情和想法，不当作关于你的事实。'); for (const item of feelings) box.append(memoryRow(item)); root.append(box); }
}
/** One memory with its source, correction and deletion. */
function memoryRow(item: MemoryItem) {
  const row = el('div', 'list-row memory-row'), main = el('div', 'row-main'), meta = el('div', 'row-meta');
  meta.append(...(item.importance && item.importance >= 4 ? [el('span', 'pill accent', '重要')] : []), el('span', '', new Date(item.createdAt).toLocaleDateString('zh-CN')), ...(item.recalls ? [el('span', '', `TA 提起过 ${item.recalls} 次`)] : []));
  const text = el('p', '', item.text); main.append(text, meta);
  const actions = el('div', 'row-actions');
  const source = button('来源', async () => {
    const old = main.querySelector('.memory-source'); if (old) { old.remove(); return; }
    const box = el('div', 'memory-source'); box.textContent = '读取中…'; main.append(box);
    const r = await command({ type: 'memory.source', id: item.id }, true);
    const d = r.data as { kind: string; role?: string; text?: string; createdAt?: string; day?: string } | undefined;
    box.textContent = !r.ok || !d ? (r.error || '找不到来源。') : d.kind === 'message' ? `${d.role === 'user' ? '你' : 'TA'} 在 ${clockText(d.createdAt!)} 说：「${d.text}」` : d.kind === 'archive' ? `来自 ${d.day} 的每日档案（原话可在「札记」里查看当天）。` : '原始消息已经不在了（可能被删除），这条记忆是当时记下的。';
  }, 'btn ghost small');
  const restore = () => actions.replaceChildren(source, fix, remove);
  const fix = button('纠正', () => {
    const editor = el('textarea'); editor.value = item.text; editor.maxLength = 1500; editor.rows = 2;
    const ok = button('保存', async () => { if (editor.value.trim()) await command({ type: 'memory.correct', id: item.id, text: editor.value.trim() }); }, 'btn primary small');
    text.replaceWith(editor); actions.replaceChildren(ok, button('取消', () => { editor.replaceWith(text); restore(); }, 'btn ghost small')); editor.focus();
  }, 'btn ghost small');
  const remove = button('删除', async () => { if (confirm('这条记忆、来源消息、同源记忆和相关札记会一起删除。确定吗？')) await command({ type: 'memory.delete', id: item.id }); }, 'btn danger small');
  restore(); row.append(main, actions);
  return row;
}
/** 主动研究：TA 从哪些渠道了解你、整理出的兴趣、替你查到的新鲜事。都能删、能改、能打分。 */
function researchSection(s: AppSnapshot) {
  const r = s.research;
  const run = button('现在研究一下', async () => { const res = await command({ type: 'research.run' }); if (res.ok) toast('TA 去查了，结果会出现在这里。'); }, 'btn ghost small');
  const box = section('TA 在研究你喜欢的东西', 'TA 会从下面这些渠道慢慢了解你的日常，整理出你的兴趣，再从不同角度、不同网站去查新鲜事，攒成笔记；聊天时会自然提起，你不在电脑前时会合成一份小报发到微信。', ...(r && !r.blocked ? [run] : []));
  box.classList.add('research');
  box.append(field('主动研究', toggle(s.settings.researchEnabled !== false, v => void settings({ researchEnabled: v })), '需要沙箱允许联网；每天最多研究 4 次，用后台额度，不打扰聊天'));
  if (!r) return box;
  if (r.blocked) box.append(notice(r.blocked, 'warn'));
  // channels
  const ch = el('div', 'research-channels');
  const hint: Record<string, string> = { apps: '打开「隐私与沙箱 → 桌面观察」后才有', browser: '连上浏览器扩展并打开桌面观察后才有', manual: '在下面加' };
  for (const c of r.channels) { const chip = el('span', `channel${c.count ? ' on' : ''}`); chip.append(el('strong', '', c.label), el('small', '', c.count ? `${c.count}` : hint[c.id] || '暂时没有')); ch.append(chip); }
  box.append(el('small', 'row-meta', 'TA 了解你的渠道'), ch);
  if (r.daily?.summary) { const d = el('div', 'research-daily'); d.append(el('small', 'row-meta', 'TA 理解的你的日常'), el('p', '', r.daily.summary)); if (r.daily.focus.length) { const chips = el('div', 'chips'); for (const f of r.daily.focus) chips.append(el('span', 'pill', f)); d.append(chips); } box.append(d); }
  // interests
  const list = el('div', 'interest-list');
  for (const i of r.interests) {
    const row = el('div', `interest${i.pinned ? ' pinned' : ''}`), main = el('div', 'row-main');
    const head = el('div', 'interest-head'); head.append(el('strong', '', i.topic), el('span', 'weight', '●'.repeat(Math.max(1, Math.min(5, i.weight)))));
    const src = el('div', 'chips'); for (const c of i.sources) src.append(el('span', 'pill', r.channels.find(x => x.id === c)?.label || c));
    main.append(head, el('small', 'row-meta', `${i.why}${i.lastResearchedAt ? ` · 上次研究 ${relativeTime(i.lastResearchedAt)}` : ' · 还没研究'}`), src);
    const acts = el('div', 'row-actions');
    acts.append(button(i.pinned ? '取消置顶' : '置顶', () => void command({ type: 'research.pinInterest', id: i.id, pinned: !i.pinned }), 'btn ghost small'), button('不用研究', async () => { if (confirm(`不再研究「${i.topic}」？之后也不会再加回来。`)) await command({ type: 'research.removeInterest', id: i.id }); }, 'btn ghost small'));
    row.append(main, acts); list.append(row);
  }
  if (!r.interests.length) list.append(el('p', 'hint', r.blocked ? '' : '还没整理出兴趣。多聊几天，或者在下面直接告诉 TA。'));
  const form = el('form', 'inline-form'), topic = el('input'); topic.maxLength = 40; topic.placeholder = '告诉 TA 一个你感兴趣的东西，比如“胶片相机”“周末展览”';
  const add = el('button', 'btn primary', '加进去'); add.type = 'submit'; form.append(topic, add);
  form.onsubmit = async e => { e.preventDefault(); if (topic.value.trim() && (await command({ type: 'research.addInterest', topic: topic.value.trim() })).ok) topic.value = ''; };
  box.append(el('small', 'row-meta', `你的兴趣（${r.interests.length}）`), list, form);
  // findings
  if (r.findings.length) {
    const fl = el('div', 'finding-list');
    for (const f of r.findings.slice(0, 12)) {
      const card = el('div', `finding${f.rating === 'down' ? ' down' : ''}`);
      const head = el('div', 'finding-head'); head.append(el('span', 'pill accent', f.topic), el('strong', '', f.title));
      const src = el('div', 'finding-sources'); for (const x of f.sources) src.append(el('small', 'selectable-text', `${x.title || ''} ${x.url}`.trim()));
      const meta = el('small', 'row-meta', `${f.angle} · 可信度 ${'★'.repeat(f.confidence)}${'☆'.repeat(5 - f.confidence)} · ${relativeTime(new Date(f.at).toISOString())}${f.sharedAt ? ' · 已经跟你说过' : ''}`);
      const acts = el('div', 'row'); acts.append(button(f.rating === 'up' ? '👍 已赞' : '👍 有用', () => void command({ type: 'research.rateFinding', id: f.id, rating: 'up' }), 'btn ghost small'), button('👎 不感兴趣', () => void command({ type: 'research.rateFinding', id: f.id, rating: 'down' }), 'btn ghost small'));
      card.append(head, el('p', '', f.summary), ...(f.why ? [el('small', 'hint', f.why)] : []), src, meta, acts); fl.append(card);
    }
    box.append(el('small', 'row-meta', 'TA 研究到的'), fl);
  }
  return box;
}

/** 「TA 眼中的你」: the overall impression, what's been on your plate, and when you usually talk. */
function profileSection(s: AppSnapshot) {
  const box = section('TA 眼中的你', '都来自你们真实的聊天和每日档案，只在这台电脑上。哪里不对，直接改。');
  box.classList.add('profile');
  // impression
  const imp = el('div', 'profile-impression');
  if (s.portrait?.text) {
    const quote = el('blockquote', '', s.portrait.text);
    const meta = el('small', 'row-meta', `${s.portrait.userEdited ? '你改写过 · ' : 'TA 每晚整理档案时更新 · '}${clockText(s.portrait.updatedAt || new Date().toISOString())}`);
    const actions = el('div', 'row wrap');
    actions.append(button('改写', () => {
      const editor = el('textarea'); editor.value = s.portrait!.text; editor.maxLength = 600; editor.rows = 4;
      const ok = button('保存', async () => { if (editor.value.trim()) { const r = await command({ type: 'portrait.update', text: editor.value.trim() }); if (r.ok) toast('TA 之后会以你写的为准。'); } }, 'btn primary small');
      quote.replaceWith(editor); actions.replaceChildren(ok); editor.focus();
    }, 'btn ghost small'), button('清除', async () => { if (confirm('清除 TA 对你的整体印象？之后每晚整理档案时会重新慢慢形成。')) await command({ type: 'portrait.clear' }); }, 'btn ghost small'));
    imp.append(el('small', 'row-meta', 'TA 对你的整体印象'), quote, meta, actions);
  } else imp.append(el('small', 'row-meta', 'TA 对你的整体印象'), el('p', 'hint', '还没形成。每天 0 点整理前一天的档案时，TA 会慢慢写下对你的印象。'));
  // recent focus
  const focus = recentFocus(s.archives || []);
  const busy = el('div', 'profile-focus');
  busy.append(el('small', 'row-meta', '最近一周在忙'));
  if (focus.topics.length) { const chips = el('div', 'chips'); for (const t of focus.topics) chips.append(el('span', 'pill', t.days > 1 ? `${t.text} · ${t.days} 天` : t.text)); busy.append(chips); }
  if (focus.threads.length) { const list = el('ul', 'profile-threads'); for (const t of focus.threads) list.append(el('li', '', t.text)); busy.append(el('small', 'row-meta', '还没聊完的事'), list); }
  if (!focus.topics.length && !focus.threads.length) busy.append(el('p', 'hint', '最近一周还没有整理好的档案。'));
  // rhythm (asked from the core: counts of your own messages per hour, no text)
  const rhythm = el('div', 'profile-rhythm'); rhythm.append(el('small', 'row-meta', '你常在什么时候找 TA'), el('p', 'hint', '统计中…'));
  void command({ type: 'profile.rhythm' }, true).then(r => {
    const d = r.data as Rhythm | undefined; rhythm.replaceChildren(el('small', 'row-meta', '你常在什么时候找 TA（近 30 天）'));
    if (!r.ok || !d || d.messages < 10) { rhythm.append(el('p', 'hint', '聊得还不够多，过几天再来看。')); return; }
    const max = Math.max(...d.hours), bars = el('div', 'rhythm-bars');
    d.hours.forEach((n, h) => { const b = el('i'); b.style.setProperty('--h', String(max ? n / max : 0)); b.title = `${h} 点：${n} 条`; if (d.peak && ((h - d.peak[0] + 24) % 24) < 4) b.classList.add('peak'); bars.append(b); });
    const axis = el('div', 'rhythm-axis'); for (const h of [0, 6, 12, 18, 24]) axis.append(el('span', '', String(h)));
    const lines = [d.peak ? `最常在 ${d.peak[0]}–${d.peak[1]} 点聊天` : '', `${d.days} 天里聊过`, d.lateNights ? `${d.lateNights} 个深夜（0–4 点）还在` : '没有熬到深夜'].filter(Boolean);
    rhythm.append(bars, axis, el('p', 'hint', lines.join(' · ') + '。'));
  });
  const grid = el('div', 'profile-grid'); grid.append(busy, rhythm);
  box.append(imp, grid);
  return box;
}

function renderDiary(root: HTMLElement, s: AppSnapshot) {
  const j = s.status.journal, archives = [...(s.archives || [])].sort((a, b) => b.day.localeCompare(a.day));
  const rebuild = (day: string) => async () => {
    if (!confirm(`重新整理 ${dayLabel(day)} 的档案？\n现有的这份档案会被新的整理结果替换，原始聊天记录不受影响。`)) return;
    const r = await command({ type: 'archive.rebuild', day }); if (r.ok) toast('已开始重新整理，完成后这里会自动更新。');
  };
  // Status line: when the nightly fold runs and whether anything is waiting or failed.
  const parts = ['每天 0 点整理前一天的对话'];
  if (j?.nextRunAt) parts.push(`下次 ${clockText(j.nextRunAt)}（${relativeTime(j.nextRunAt)}）`);
  if (j?.lastDay) parts.push(`最近一份：${dayLabel(j.lastDay)}`);
  if (j?.pendingDays.length) parts.push(`还有 ${j.pendingDays.length} 天等待整理`);
  root.append(notice(parts.join(' · '), '', undefined, j?.pendingDays.length ? 'warn busy' : 'ok'));
  for (const day of (j?.failedDays || []).filter(d => !archives.some(a => a.day === d))) root.append(notice(`${dayLabel(day)} 的档案没有整理成功。`, 'warn', button('重新整理', rebuild(day), 'btn ghost small'), 'warn'));
  if (!archives.length && !s.diary.length) { const box = section('第一页'); box.append(emptyPet(s, '第一页还空着。今天聊过的话，会在明天 0 点变成第一份档案。', 'doodle')); root.append(box); return; }
  const list = el('div', 'archive-list');
  archives.forEach((a, i) => {
    const card = el('details', 'card flush archive'); card.open = i < 2;
    const d = new Date(`${a.day}T12:00:00`), head = el('summary', 'archive-head');
    const date = el('div', 'archive-date'); date.append(el('strong', '', Number.isNaN(d.getTime()) ? a.day.slice(-2) : String(d.getDate())), el('small', '', Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN', { month: 'short', weekday: 'short' })));
    const title = el('div', 'archive-title'); title.append(el('strong', '', a.title || dayLabel(a.day)));
    const meta = el('div', 'archive-meta'); if (a.mood) meta.append(el('span', 'pill accent', a.mood)); meta.append(el('span', 'pill', `${a.messageCount} 条消息`)); title.append(meta);
    // Inside <summary>: stop the click from also toggling the card.
    const redo = tip(el('button', 'btn ghost small', '重新整理'), '按原始聊天记录重写这一天的档案', 'top'); redo.type = 'button';
    redo.onclick = event => { event.preventDefault(); event.stopPropagation(); void rebuild(a.day)(); };
    head.append(date, title, redo, el('span', 'archive-chevron', '›'));
    const body = el('div', 'archive-body');
    if (a.summary) body.append(el('p', '', a.summary));
    if (a.diary) { const diary = el('blockquote', 'tile diary-note'); diary.append(el('small', '', `${s.identity.name || 'TA'} 的日记`), el('p', '', a.diary)); body.append(diary); }
    if (a.topics.length) { const chips = el('div', 'chips'); for (const t of a.topics) chips.append(el('span', 'pill', `# ${t}`)); body.append(chips); }
    const cols = el('div', 'archive-cols');
    for (const [heading, items, tone] of [['今天的高光', a.highlights, 'pink'], ['未完待续', a.openThreads, 'warn']] as const) {
      if (!items.length) continue;
      const col = el('div', 'tile'), h = el('h4'), ul = el('ul'); h.append(el('i', `dot ${tone}`), heading); col.append(h); for (const item of items) ul.append(el('li', '', item)); col.append(ul); cols.append(col);
    }
    if (cols.childElementCount) body.append(cols);
    card.append(head, body); list.append(card);
  });
  if (archives.length) root.append(list);
  if (s.diary.length) {
    const notes = section('随手札记', '更早的小日记：每 10 次相处写一篇。');
    const items = el('div', 'diary-list');
    for (const entry of [...s.diary].reverse()) {
      const card = el('article', 'tile');
      card.append(el('time', '', new Date(entry.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }) + (entry.title ? ` ·《${entry.title}》` : '')), el('p', '', entry.text), el('small', 'hint', `引用 ${entry.sourceIds.length} 条真实相处记录`));
      items.append(card);
    }
    notes.append(items); root.append(notes);
  }
}

function renderAchievements(root: HTMLElement, s: AppSnapshot) {
  const bond = s.bond, name = s.identity.name || s.persona?.active.name || 'TA';
  const list = bond?.achievements?.length ? bond.achievements : achievementDefs.map(({ id, icon, title, description, hidden }) => ({ id, icon, title, description, hidden, unlockedAt: undefined as string | undefined }));
  const unlocked = list.filter(a => a.unlockedAt).length;
  const hero = el('section', 'card feature bond-hero');
  const info = el('div', 'bond-hero-info');
  const met = bond?.firstMetAt ? new Date(bond.firstMetAt) : undefined;
  info.append(el('h3', '', met ? `和${name}相识于 ${met.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}` : `和${name}的故事刚刚开始`), el('p', 'hint', bond ? '每天来打个招呼，连续天数就会增长；断了也没关系，TA 会一直在。' : '相处数据还在加载，稍后就会出现。'));
  const stats = el('div', 'bond-stats');
  for (const [value, label, icon] of [[bond?.daysTogether, '陪伴天数', '🌱'], [bond?.streakDays, '连续打卡', '🔥'], [bond?.activeDays, '相处过的日子', '📅'], [bond?.todayChats, '今天聊了', '💬']] as const) {
    const stat = el('div', 'tile stat'); stat.append(iconBadge(icon, 'sm'), el('strong', '', value === undefined ? '—' : String(value)), el('small', '', label)); stats.append(stat);
  }
  info.append(stats);
  hero.append(miniPet(s, unlocked ? 'celebrate' : 'wave', 'pleased', 'bond-hero-pet'), info);
  const badges = section('成就徽章', `已解锁 ${unlocked} / ${list.length}`);
  const progress = el('div', 'progress'); const bar = el('i'); bar.style.width = `${Math.round((unlocked / Math.max(1, list.length)) * 100)}%`; progress.append(bar); badges.append(progress);
  const grid = el('div', 'trophy-grid');
  for (const a of list) {
    const def = achievementDefs.find(d => d.id === a.id), secret = !a.unlockedAt && (a.hidden ?? def?.hidden);
    const tile = el('article', `tile trophy${a.unlockedAt ? ' unlocked' : ' locked'}${secret ? ' secret' : ''}`);
    tile.append(iconBadge(secret ? '？' : a.icon, 'lg emoji'), el('strong', '', secret ? '？？？' : a.title), el('small', '', secret ? '隐藏成就，相处中自然会遇到' : a.description));
    tile.append(el('span', 'trophy-foot', a.unlockedAt ? `${new Date(a.unlockedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 解锁` : def?.client ? '桌宠互动' : '相处中解锁'));
    if (a.unlockedAt) tip(tile, `${a.title} · ${clockText(a.unlockedAt)}`, 'top');
    grid.append(tile);
  }
  badges.append(grid);
  const how = section('和小人玩耍', '这些都只在本机发生，不会调用模型。');
  const tips = el('div', 'tile-grid');
  for (const [icon, title, text] of [['🤲', '摸摸头', '鼠标在小人头上来回轻扫'], ['⚡', '蓄力跳', '按住小人一秒多，看到发光再松手'], ['🪁', '甩出去', '拖着小人快速一甩再松手'], ['👉', '戳一戳', '连续轻点小人'], ['😵', '晃一晃', '拖着小人左右快速摇晃'], ['⌨️', 'Ctrl+K', '在这里打开快捷操作']] as const) {
    const t = el('div', 'tile play-tip'); t.append(iconBadge(icon), el('strong', '', title), el('small', '', text)); tips.append(t);
  }
  how.append(tips);
  root.append(hero, badges, how);
}

function renderConfig(root: HTMLElement, s: AppSnapshot) {
  const model = section('对话模型', '任何 OpenAI 兼容接口都可以（/chat/completions，支持 JSON 输出）。');
  const form = el('form', 'form-grid');
  const mode = select(s.provider.mode || 'native-api', [['native-api', '标准 OpenAI 兼容接口'], ['mira-proxy', 'Mira 本地反代（自动拉起）']], () => {});
  const lim = s.settings.modelLimits && s.settings.modelLimits.model === s.provider.model && s.settings.modelLimits.baseUrl === s.provider.baseUrl ? s.settings.modelLimits : undefined;
  const windowIn = el('input'), outIn = el('input');
  for (const i of [windowIn, outIn]) { i.type = 'number'; i.min = '0'; i.step = '1000'; }
  windowIn.value = s.settings.contextWindow ? String(s.settings.contextWindow) : ''; windowIn.placeholder = `自动：${(lim?.contextWindow || DEFAULT_CONTEXT_WINDOW).toLocaleString()}`;
  outIn.value = s.settings.maxOutputTokens ? String(s.settings.maxOutputTokens) : ''; outIn.placeholder = lim?.maxOutput ? `自动：${Math.min(lim.maxOutput, 32768).toLocaleString()}（接口上限 ${lim.maxOutput.toLocaleString()}）` : '自动：4,096';
  const chatEp = endpointInputs('chat', s.provider.baseUrl, s.provider.model, s.provider.configured ? '已加密保存；留空保留原密钥' : '填入 API Key', info => {
    windowIn.placeholder = `自动：${(info?.contextWindow || DEFAULT_CONTEXT_WINDOW).toLocaleString()}${info?.contextWindow ? '（接口报告）' : ''}`;
    outIn.placeholder = info?.maxOutput ? `自动：${Math.min(info.maxOutput, 32768).toLocaleString()}（接口上限 ${info.maxOutput.toLocaleString()}）` : '自动：4,096';
  });
  const { url, model: name, key } = chatEp; url.required = true; name.required = true;
  form.append(field('接入方式', mode), ...chatEp.fields,
    field('上下文窗口', windowIn, `留空 = 用接口报告的值，接口不报就按 100 万（主流模型的大小）。${lim?.contextWindow ? `接口报告：${lim.contextWindow.toLocaleString()}` : ''}`),
    field('单次输出上限', outIn, `留空 = 用接口报告的上限（聊天一句话最多取 32,768），接口不报就 4,096。${lim?.maxOutput ? `接口报告：${lim.maxOutput.toLocaleString()}` : ''}`));
  const presets = el('div', 'row wrap');
  presets.append(el('small', 'hint', '快速填入：'));
  for (const [label, m, u, n] of [['Mira K3.1 Pro', 'mira-proxy', MIRA_DEFAULT_BASE_URL, MIRA_DEFAULT_MODEL], ['DeepSeek', 'native-api', 'https://api.deepseek.com/v1', 'deepseek-chat'], ['Moonshot', 'native-api', 'https://api.moonshot.cn/v1', 'kimi-k2.5'], ['通义千问', 'native-api', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus'], ['OpenAI', 'native-api', 'https://api.openai.com/v1', 'gpt-4.1-mini'], ['本地 Ollama', 'native-api', 'http://127.0.0.1:11434/v1', 'qwen2.5']] as const)
    presets.append(button(label, () => { mode.value = m; url.value = u; name.value = n; }, 'chip small'));
  const save = el('button', 'btn primary', '保存连接'); save.type = 'submit';
  form.append(presets, save);
  form.onsubmit = async event => { event.preventDefault(); const k = key.value; key.value = ''; const r = await command({ type: 'config.save', baseUrl: url.value.trim(), model: name.value.trim(), mode: mode.value as 'mira-proxy' | 'native-api', ...(k ? { apiKey: k } : {}) }); if (!r.ok) return;
    const win = Number(windowIn.value), out = Number(outIn.value);
    await settings({ contextWindow: windowIn.value.trim() && Number.isFinite(win) ? win : 0, maxOutputTokens: outIn.value.trim() && Number.isFinite(out) ? out : 0 });
    toast('连接已保存；上下文窗口和输出上限会按接口报告自动更新。'); };
  model.append(form, el('p', 'hint', '密钥只交给桌面进程，用 Windows DPAPI 加密保存，不会进入页面、聊天记录或日志。'));
  const tts = section('语音合成（可选）', '支持小米 MiMo TTS（会按角色卡的声音风格演绎）、OpenAI /audio/speech 和系统离线语音。');
  const tform = el('form', 'form-grid');
  const ttsEp = endpointInputs('tts', s.settings.ttsBaseUrl || '', s.settings.ttsModel || '', '可选；留空保留原密钥');
  const { url: tUrl, model: tModel, key: tKey } = ttsEp; tUrl.placeholder = 'https://api.xiaomimimo.com/v1'; tModel.placeholder = 'mimo-v2.5-tts / tts-1';
  const tFormat = select(s.settings.ttsFormat || '', [['', '按地址自动判断'], ...TTS_FORMATS], () => {});
  const tVoice = el('input'); tVoice.value = s.settings.ttsVoice || ''; tVoice.placeholder = '音色名';
  let speed = s.settings.ttsSpeed || 1;
  tform.append(field('启用自动朗读', toggle(!!s.settings.ttsEnabled, v => void command({ type: 'tts.configure', ttsEnabled: v }))), field('请求格式', tFormat), ...ttsEp.fields, field('音色', tVoice), field('语速', numberInput(speed, v => { speed = v; }, { step: 0.1, unit: '倍' })));
  const tsave = el('button', 'btn primary', '保存语音'); tsave.type = 'submit';
  const row = el('div', 'row'); row.append(tsave, button('试听', async () => { const p = s.persona?.active; const r = await command({ type: 'tts.speak', text: p?.greeting || '你好，很高兴认识你。' }); if (r.ok) toast('正在试听…'); }, 'btn ghost'));
  tform.append(row);
  tform.onsubmit = async event => { event.preventDefault(); const k = tKey.value.trim(); tKey.value = ''; const r = await command({ type: 'tts.configure', ttsBaseUrl: tUrl.value.trim(), ttsModel: tModel.value.trim(), ttsVoice: tVoice.value.trim(), ttsSpeed: Math.max(0.5, Math.min(2, speed)), ...(tFormat.value ? { ttsFormat: tFormat.value as 'openai-speech' | 'mimo-chat-audio' } : {}), ...(k ? { ttsApiKey: k } : {}) }); if (r.ok) toast('语音配置已保存。'); };
  tts.append(tform);
  const stt = voiceInputSection(s);
  const wx = wechatSection(s);
  const agent = section('本机执行器', `${27 + (s.agent?.mcp || []).reduce((n, m) => n + m.tools, 0)} 个工具：文件读写与多文件补丁、搜索、Shell、网页搜索与读网页、子代理${s.agent?.mcp?.length ? '、MCP' : ''}；会读取工作目录里的 AGENTS.md，长任务自动压缩上下文，改动可撤销。当前沙箱：${({ strict: '严格', standard: '标准', open: '宽松', full: '完全放开' })[s.settings.sandbox?.level || 'standard']}，可在「隐私与沙箱」调整。`);
  const aform = el('form', 'form-grid');
  const cwd = el('input'); cwd.value = s.agent?.cwd || '';
  const task = el('textarea'); task.rows = 3; task.maxLength = 12000; task.placeholder = '要执行的任务，例如：统计这个文件夹里有多少张图片';
  const run = el('button', 'btn primary', '开始执行'); run.type = 'submit';
  const last = s.agent?.lastResult;
  const running = s.agent?.running || [];
  const status = el('p', 'hint', running.length ? `${running.length} 个任务执行中，聊天不受影响` : s.agent?.busy ? '执行中，聊天不受影响。' : last ? `上次：${({ done: '完成', failed: '未完成', cancelled: '已取消' })[last.status]} · ${last.toolCount} 次工具调用${last.changedFiles ? ` · 改了 ${last.changedFiles} 个文件${last.undone ? '（已撤销）' : ''}` : ''}` : '待命');
  const pickCwd = button('选择文件夹…', async () => { const r = await command({ type: 'agent.pickCwd' }); const picked = (r.data as { cwd?: string } | undefined)?.cwd; if (r.ok && picked) { cwd.value = picked; toast('工作目录已更新。'); } }, 'btn primary');
  pickCwd.prepend(svgIcon('folder', 16)!);
  cwd.title = cwd.value; cwd.spellcheck = false;
  const cwdRow = el('div', 'row'); cwdRow.append(cwd, pickCwd, button('保存', async () => { if ((await command({ type: 'agent.configure', cwd: cwd.value.trim() })).ok) toast('工作目录已保存。'); }, 'btn ghost'));
  const undo = button('撤销上次改动', async () => { if (!confirm(`把上次任务改过的 ${last?.changedFiles ?? ''} 个文件恢复原样？之后又被改过的文件不会动。`)) return; const r = await command({ type: 'agent.undo' }); if (r.ok) toast('已撤销，详情见聊天记录。'); }, 'btn ghost');
  undo.hidden = !last?.changedFiles || !!last.undone || !!s.agent?.busy;
  const runRow = el('div', 'row'); runRow.append(run, button('取消执行', () => void command({ type: 'agent.cancel' }), 'btn ghost'), undo, el('span', 'spacer'), status);
  aform.append(field('工作目录', cwdRow, '沙箱的“工作目录”指这里', 'field wide'), field('任务', task, '', 'field wide'), runRow);
  aform.onsubmit = async event => { event.preventDefault(); if (task.value.trim() && (await command({ type: 'agent.run', task: task.value.trim() })).ok) toast('任务已交给执行器，结果会回到聊天里。'); };
  agent.append(aform);
  if (running.length) {
    const list = el('div', 'stack');
    for (const r of running) { const row = el('div', 'list-row'), main = el('div', 'row-main'); main.append(el('strong', '', r.task), el('small', 'row-meta', `开始于 ${clockText(r.startedAt)}`)); row.append(iconBadge('terminal', 'accent'), main, button('取消', () => void command({ type: 'agent.cancel', id: r.id }), 'btn ghost small')); list.append(row); }
    agent.append(list);
  }
  // Executor model and budget (Codex-style: a stronger coding model for tasks, the chat model for talking).
  const ex = s.settings.executor || {};
  const exModel = el('input'); exModel.value = ex.model || ''; exModel.placeholder = `留空 = 用聊天模型（${s.provider.model}）`; exModel.onchange = () => void settings({ executor: { model: exModel.value.trim() } });
  agent.append(el('div', 'form-grid'));
  agent.lastElementChild!.append(
    field('执行器模型', exModel, '同一个 API 地址下的另一个模型，例如更擅长编程的那个', 'field wide'),
    field('单次输出上限', numberInput(ex.maxOutputTokens ?? 8192, v => void settings({ executor: { maxOutputTokens: v } }), { step: 1024, unit: 'tokens' }), '模型不支持时会报错，调小即可'),
    field('每个任务最多回合', numberInput(ex.maxTurns ?? 200, v => void settings({ executor: { maxTurns: v } }), { step: 10, unit: '轮' })),
    field('最多同时执行', numberInput(ex.maxParallel ?? 3, v => void settings({ executor: { maxParallel: v } }), { step: 1, unit: '个任务' }), 'TA 可以把几件事同时交给多个执行代理'),
  );
  // MCP servers: local programs (stdio) or remote URLs (Streamable HTTP), like Codex CLI / Kimi Code.
  const mcp = section('MCP 工具服务', '接入 Model Context Protocol 服务给执行器加工具（浏览器自动化、GitHub、数据库、Figma…）。本地命令需要沙箱允许 Shell，远程网址需要允许联网；标准档下每个任务第一次使用前会问你，宽松/完全放开不再询问。密钥用系统加密保存，界面只显示名称。');
  const servers = s.settings.mcpServers || [], states = new Map((s.agent?.mcp || []).map(m => [m.name, m]));
  const saveServers = (next: typeof servers) => void settings({ mcpServers: next });
  mcp.append(presetGallery(servers.map(sv => sv.url || `${sv.command} ${(sv.args || []).join(' ')}`)));
  if (!servers.length) mcp.append(el('p', 'hint', '也可以在最下面手动添加任何 MCP 服务：本地命令（如 npx + 参数）或远程网址。'));
  for (const [i, server] of servers.entries()) {
    const row = el('div', 'list-row'), main = el('div', 'row-main'), st = states.get(server.name), remote = !!server.url;
    const keys = [...(server.envKeys || []), ...(server.headerKeys || [])];
    main.append(el('strong', '', `${server.name}${remote ? ' · 远程' : ' · 本地'}`), el('small', 'row-meta', (server.url || `${server.command} ${(server.args || []).join(' ')}`).slice(0, 160)),
      el('small', 'row-meta', `${!server.enabled ? '已停用' : st?.state === 'ready' ? `已连接 · ${st.tools} 个工具` : st?.state === 'failed' ? `连接失败：${st.error || ''}` : st?.state === 'starting' ? '连接中…' : '首次执行任务时启动'}${keys.length ? ` · 密钥：${keys.join('、')}` : ''}`));
    const secretFold = el('details', 'fold'); const sum = el('summary', '', keys.length ? '更新密钥' : '设置密钥'); const body = el('div', 'fold-body');
    const area = el('textarea'); area.rows = 3; area.placeholder = remote ? '每行一个请求头：Authorization=Bearer xxx' : '每行一个环境变量：GITHUB_TOKEN=xxx'; area.autocomplete = 'off'; area.spellcheck = false;
    const saveKey = button('保存（覆盖原有）', async () => {
      let map: Record<string, string>;
      try { map = Object.fromEntries(area.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const k = l.indexOf('='); if (k <= 0) throw new Error(`每行写成 名称=值：${l.slice(0, 20)}`); return [l.slice(0, k).trim(), l.slice(k + 1).trim()]; })); } catch (error) { toast(error instanceof Error ? error.message : '格式不对', 'error'); return; }
      const r = await command({ type: 'mcp.secret', server: server.name, ...(remote ? { headers: map } : { env: map }) }); area.value = ''; if (r.ok) toast(Object.keys(map).length ? '密钥已加密保存。' : '密钥已清除。');
    }, 'btn primary small');
    body.append(area, saveKey); secretFold.append(sum, body); main.append(secretFold);
    row.append(iconBadge(remote ? '🌐' : '🧩', 'accent'), main, toggle(server.enabled, v => saveServers(servers.map((x, j) => j === i ? { ...x, enabled: v } : x)), `启用 ${server.name}`), button('删除', () => { if (keys.length) void command({ type: 'mcp.secret', server: server.name }, true); saveServers(servers.filter((_, j) => j !== i)); }, 'btn ghost small'));
    mcp.append(row);
  }
  const mform = el('form', 'inline-form'), mName = el('input'), mTarget = el('input'), mArgs = el('input');
  mName.placeholder = '名称'; mName.maxLength = 32; mTarget.placeholder = '命令（如 npx）或网址（https://…）'; mArgs.placeholder = '命令参数，空格分隔';
  mTarget.oninput = () => { mArgs.disabled = /^https?:\/\//i.test(mTarget.value.trim()); };
  const mAdd = el('button', 'btn primary', '添加'); mAdd.type = 'submit'; mform.append(mName, mTarget, mArgs, mAdd);
  mform.onsubmit = async event => {
    event.preventDefault(); const name = mName.value.trim(), target = mTarget.value.trim(); if (!name || !target) { toast('名称和命令/网址都要填', 'error'); return; }
    const entry = /^https?:\/\//i.test(target) ? { name, url: target, enabled: true } : { name, command: target, args: mArgs.value.trim() ? mArgs.value.trim().split(/\s+/) : [], enabled: true };
    const r = await settings({ mcpServers: [...servers, entry] }); if (r.ok) { mName.value = mTarget.value = mArgs.value = ''; }
  };
  const mRow = el('div', 'row wrap'); mRow.append(button('现在连接 / 重连', async () => { if ((await command({ type: 'mcp.restart' })).ok) toast('正在连接，稍后看状态。'); }, 'btn ghost small'));
  mcp.append(mform, mRow);
  const archive = section('存档', '存档包含聊天、记忆、日记、自定义角色卡与提醒，不包含任何密钥。');
  const arow = el('div', 'row wrap'); arow.append(button('导出相处存档', () => void command({ type: 'app.export' }), 'btn ghost'), button('恢复存档…', () => void command({ type: 'app.import' }), 'btn ghost'));
  archive.append(arow);
  const thanks = section('致谢', '特别鸣谢：Gemini4argon · opus5.5 · gpt-Astra');
  root.append(model, wx, tts, stt, agent, mcp, archive, thanks);
}
