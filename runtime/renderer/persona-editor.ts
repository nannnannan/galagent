// Character-card editor for the 角色 page: 「简单写法」 (plain fields) and 「酒馆写法」 (structured card:
// palette, derivations, dialogue samples, facets, author's notes, phases, NPCs). Both modes edit one draft,
// so switching never loses text. The editor owns its DOM; the notebook only mounts it.
import { parseRoutineLines, routineLines } from '../shared/routine';
import type { AppSnapshot, PersonaDraft, PersonaProfile } from '../shared/contracts';
import { activePhase, blankPersona, CARD_LIMITS, emptyCard, PERSONA_LIMITS, type PersonaCard, type PersonaDerivation, type PersonaFacet, type PersonaNote, type PersonaNpc, type PersonaPhase } from '../shared/personas';
import { builtinPixelPets } from '../shared/pixel-pets';
import { button, command, el, field, select, toast } from './ui';

const C = CARD_LIMITS, L = PERSONA_LIMITS;
type Mode = 'simple' | 'tavern';

// ---------------- card helpers (pure) ----------------
const trimList = (items: string[]) => items.map(x => x.trim()).filter(Boolean);
const cleanDerivations = (items: PersonaDerivation[]) => items.map(d => ({ trait: d.trait.trim(), text: d.text.trim() })).filter(d => d.text);
const cleanNotes = (items: PersonaNote[]) => items.map(n => ({ topic: n.topic.trim(), text: n.text.trim() })).filter(n => n.text);
/** Trims every string and drops rows that carry nothing, mirroring what the core keeps. */
export function cleanCard(card: PersonaCard): PersonaCard {
  return {
    age: card.age.trim(), gender: card.gender.trim(), identity: card.identity.trim(), appearance: card.appearance.trim(),
    base: card.base.trim(), main: trimList(card.main), accents: trimList(card.accents), derivations: cleanDerivations(card.derivations),
    lines: trimList(card.lines),
    facets: card.facets.map(f => ({ name: f.name.trim(), trigger: f.trigger.trim(), energy: f.energy.trim(), lines: trimList(f.lines), body: f.body.trim(), purpose: f.purpose.trim() })).filter(f => f.name || f.trigger || f.lines.length || f.energy || f.body || f.purpose),
    transitions: card.transitions.trim(), leaks: card.leaks.trim(), notes: cleanNotes(card.notes),
    phases: card.phases.map(p => ({ name: p.name.trim(), fromDays: Math.max(0, Math.floor(Number(p.fromDays) || 0)), main: trimList(p.main), accents: trimList(p.accents), derivations: cleanDerivations(p.derivations), notes: cleanNotes(p.notes) })).filter(p => p.name || p.main.length || p.accents.length || p.derivations.length || p.notes.length),
    npcs: card.npcs.map(n => ({ name: n.name.trim(), role: n.role.trim(), look: n.look.trim(), traits: n.traits.trim(), relation: n.relation.trim(), lines: trimList(n.lines) })).filter(n => n.name || n.role || n.look || n.traits || n.relation || n.lines.length),
  };
}
export const isEmptyCard = (card: PersonaCard | undefined) => !card || JSON.stringify(cleanCard(card)) === JSON.stringify(emptyCard());
/** Fills any missing parts so the editor can bind to every field (imported or AI-drafted cards may be partial). */
export function completeCard(raw: Partial<PersonaCard> | undefined): PersonaCard {
  const card = { ...emptyCard(), ...structuredClone(raw || {}) } as PersonaCard;
  const strs = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const derivs = (v: unknown) => Array.isArray(v) ? v.map(d => ({ trait: String(d?.trait ?? ''), text: String(d?.text ?? '') })) : [];
  const notes = (v: unknown) => Array.isArray(v) ? v.map(n => ({ topic: String(n?.topic ?? ''), text: String(n?.text ?? '') })) : [];
  for (const key of ['age', 'gender', 'identity', 'appearance', 'base', 'transitions', 'leaks'] as const) card[key] = String(card[key] ?? '');
  card.main = strs(card.main); card.accents = strs(card.accents); card.lines = strs(card.lines);
  card.derivations = derivs(card.derivations); card.notes = notes(card.notes);
  card.facets = (Array.isArray(card.facets) ? card.facets : []).map(f => ({ name: String(f?.name ?? ''), trigger: String(f?.trigger ?? ''), energy: String(f?.energy ?? ''), lines: strs(f?.lines), body: String(f?.body ?? ''), purpose: String(f?.purpose ?? '') }));
  card.phases = (Array.isArray(card.phases) ? card.phases : []).map(p => ({ name: String(p?.name ?? ''), fromDays: Number(p?.fromDays) || 0, main: strs(p?.main), accents: strs(p?.accents), derivations: derivs(p?.derivations), notes: notes(p?.notes) }));
  card.npcs = (Array.isArray(card.npcs) ? card.npcs : []).map(n => ({ name: String(n?.name ?? ''), role: String(n?.role ?? ''), look: String(n?.look ?? ''), traits: String(n?.traits ?? ''), relation: String(n?.relation ?? ''), lines: strs(n?.lines) }));
  return card;
}

/** Small badges for a persona list card: tavern method, and which phase is in effect. */
export function personaBadges(p: PersonaProfile, daysTogether: number): HTMLElement[] {
  if (isEmptyCard(p.card)) return [];
  const out = [el('span', 'pill accent', '酒馆写法')];
  const phases = p.card!.phases;
  if (phases.length) {
    const now = activePhase(p.card, daysTogether);
    out.push(now ? el('span', 'pill ok', `阶段 · ${now.name || `第 ${now.fromDays} 天起`}`) : el('span', 'pill', `第 ${phases[0].fromDays} 天进入「${phases[0].name || '下一阶段'}」`));
  }
  return out;
}

/** The method in ten lines; the full skill lives in skills/galagent-persona/SKILL.md. */
export function guidePanel() {
  const box = el('aside', 'tile guide'); box.setAttribute('aria-label', '写卡指南');
  box.append(el('strong', '', '写卡指南 · 酒馆写法'));
  const list = el('ol');
  for (const [head, text] of [
    ['外貌', '只写偏离默认的特征：遮住名字也能认出是谁。不写“精致白皙”这类万能描写。'],
    ['调色盘', '一个底色（最深处不会变的那层）、1–2 个主色调、几个点缀，组合起来才是活人。'],
    ['衍生', '最重要的一步：每个性格 2–3 条具体场景里的具体动作，不写抽象定义。'],
    ['不通顺', '衍生之间有点矛盾、不通顺也没关系，那可能正是角色活过来的地方。'],
    ['语料', '只写台词，不混动作和心理。AI 学的是语气，不会照着复读。'],
    ['二次解释', '告诉 AI “我的角色是这样的，不是你以为的那样”：真正含义、不是什么、何时出现、和其他性格的关系。'],
    ['三面性', '只在压力性质截然不同、行为完全不同时才需要；写怎么运作，不写为什么。'],
    ['多阶段', '底色不随阶段变；阶段衍生是新出现的行为，不是上一阶段的升级版。按相处天数自动切换。'],
    ['NPC', '相关人物只写功能需要的部分。'],
    ['AI 起草', '只帮你搭骨架、提问题；衍生和二次解释请自己写——那是这张卡的灵魂。'],
  ] as const) { const li = el('li'); li.append(el('b', '', head + '：'), text); list.append(li); }
  box.append(list, el('p', 'hint', '完整方法见 skills/galagent-persona/SKILL.md。'));
  return box;
}

// ---------------- small controls ----------------
/** Input/textarea with a character counter that appears near the limit. */
function counted(value: string, max: number, onInput: (value: string) => void, options: { rows?: number; placeholder?: string } = {}) {
  const wrap = el('span', 'counted');
  const control = options.rows ? el('textarea') : el('input');
  if (options.rows) (control as HTMLTextAreaElement).rows = options.rows;
  control.maxLength = max; control.value = value; if (options.placeholder) control.placeholder = options.placeholder;
  const counter = el('small', 'counter'); counter.setAttribute('aria-live', 'polite');
  const sync = () => { const n = [...control.value].length, ratio = n / max; counter.hidden = ratio < 0.7; counter.textContent = `${n} / ${max}`; counter.classList.toggle('near', ratio >= 0.85 && ratio < 1); counter.classList.toggle('full', ratio >= 1); };
  control.addEventListener('input', () => { onInput(control.value); sync(); });
  sync(); wrap.append(control, counter); return wrap;
}
/** One labelled control in the tavern editor (div so repeatable rows with buttons stay valid). */
function edField(label: string, control: HTMLElement, hint = '', wide = false) {
  const box = el(control.querySelector('button') ? 'div' : 'label', `ed-field${wide ? ' wide' : ''}`);
  const text = el('span'); text.append(label); if (hint) text.append(el('small', '', hint)); box.append(text, control); return box;
}
/** Chip list with an inline input: Enter / 逗号 adds, × or Backspace on empty removes. Mutates `values`. */
function tagInput(values: string[], max: number, placeholder: string, onChange: () => void) {
  const box = el('div', 'tag-input'), input = el('input'); input.maxLength = C.short; input.placeholder = placeholder;
  const draw = () => {
    box.querySelectorAll('.pill').forEach(x => x.remove());
    values.forEach((v, i) => {
      const chip = el('span', 'pill accent', v), x = el('button', '', '×'); x.type = 'button'; x.setAttribute('aria-label', `移除「${v}」`);
      x.onclick = () => { values.splice(i, 1); draw(); onChange(); input.focus(); }; chip.append(x); box.insertBefore(chip, input);
    });
    input.hidden = values.length >= max; input.placeholder = values.length ? '' : placeholder;
  };
  const commit = () => {
    const parts = input.value.split(/[,，、]/).map(x => x.trim()).filter(Boolean); input.value = '';
    for (const part of parts) if (values.length < max && !values.includes(part)) values.push(part);
    if (parts.length) { draw(); onChange(); }
  };
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    else if (event.key === 'Backspace' && !input.value && values.length) { values.pop(); draw(); onChange(); }
  });
  input.addEventListener('input', () => { if (/[,，、]/.test(input.value)) commit(); });
  input.addEventListener('blur', commit);
  box.onclick = event => { if (event.target === box) input.focus(); };
  box.append(input); draw(); return box;
}
/** Rows you can add, remove and reorder. `row` builds the body for one item; the list redraws itself on structural changes. */
function repeatable<T>(items: T[], options: { max: number; add: string; blank: () => T; row: (item: T, index: number) => HTMLElement; flat?: boolean; onChange?: () => void; label?: (index: number) => string }) {
  const host = el('div', 'stack'), list = el('div', 'rep-list'), foot = el('div', 'rep-foot'), count = el('small');
  const add = button(`+ ${options.add}`, () => { if (items.length >= options.max) return; items.push(options.blank()); draw(); options.onChange?.(); list.lastElementChild?.querySelector<HTMLElement>('input, textarea, select')?.focus(); }, 'btn ghost small');
  const move = (from: number, to: number) => { const [x] = items.splice(from, 1); items.splice(to, 0, x); draw(); options.onChange?.(); };
  function draw() {
    list.replaceChildren();
    items.forEach((item, i) => {
      const row = el('div', `rep-row${options.flat ? ' flat' : ''}`), tools = el('div', 'rep-tools'), name = options.label?.(i) || `第 ${i + 1} 条`;
      const up = button('↑', () => move(i, i - 1), 'icon-btn'), down = button('↓', () => move(i, i + 1), 'icon-btn'), remove = button('×', () => { items.splice(i, 1); draw(); options.onChange?.(); }, 'icon-btn danger');
      up.disabled = i === 0; down.disabled = i === items.length - 1;
      up.setAttribute('aria-label', `上移${name}`); down.setAttribute('aria-label', `下移${name}`); remove.setAttribute('aria-label', `删除${name}`);
      tools.append(up, down, remove);
      if (options.flat) row.append(el('span', 'rep-index', String(i + 1)));
      row.append(options.row(item, i), tools); list.append(row);
    });
    count.textContent = `${items.length} / ${options.max}`; add.disabled = items.length >= options.max;
  }
  foot.append(add, count); host.append(list, foot); draw(); return host;
}
const linesText = (values: string[], max: number, onChange: (v: string[]) => void, rows = 3, placeholder = '每行一句') => {
  const area = el('textarea'); area.rows = rows; area.value = values.join('\n'); area.placeholder = placeholder;
  area.oninput = () => onChange(area.value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, max)); return area;
};
function edSection(title: string, hint: string, optional = false, open = true) {
  if (optional) {
    const fold = el('details', 'fold'); fold.open = open;
    const summary = el('summary'); summary.append(title, el('small', '', '可选')); fold.append(summary);
    const body = el('div', 'fold-body'); body.append(el('p', 'hint', hint)); fold.append(body);
    return { box: fold, body };
  }
  const box = el('section', 'ed-section'), head = el('div', 'ed-section-head'); head.append(el('h4', '', title), el('p', 'hint', hint)); box.append(head);
  return { box, body: box };
}

// ---------------- the editor ----------------
export function openPersonaEditor(root: HTMLElement, s: AppSnapshot, base?: PersonaProfile) {
  const draft: PersonaDraft = base ? { ...base } : blankPersona();
  const editable = base && !base.builtin ? base.id : undefined;
  let card = completeCard(base?.card), mode: Mode = isEmptyCard(base?.card) ? 'simple' : 'tavern';
  const days = Math.max(0, s.bond?.daysTogether || 0);
  const form = el('form', 'card editor'); form.noValidate = true;

  // header: title, mode tabs, guide
  const head = el('header', 'card-head'), title = el('div');
  title.append(el('h3', '', base ? (base.builtin ? `以「${base.name}」为模板新建` : `编辑「${base.name}」`) : '新建角色卡'), el('p', 'hint', '两种写法共用一份草稿，随时切换不会丢字。'));
  const tabs = el('div', 'tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '写法');
  const tabButtons = (['simple', 'tavern'] as const).map(m => { const t = button(m === 'simple' ? '简单写法' : '酒馆写法（进阶）', () => setMode(m), 'tab'); t.setAttribute('role', 'tab'); t.dataset.mode = m; return t; });
  tabs.append(...tabButtons);
  const guide = guidePanel(); guide.hidden = true;
  const guideButton = button('写卡指南', () => { guide.hidden = !guide.hidden; guideButton.setAttribute('aria-expanded', String(!guide.hidden)); }, 'btn ghost small');
  guideButton.setAttribute('aria-expanded', 'false');
  head.append(title, tabs, guideButton);

  // AI draft + follow-up questions
  const ai = el('div', 'ai-draft'), brief = el('input'); brief.placeholder = '一句话描述，例如：会做饭的狼人管家，嘴硬心软'; brief.maxLength = 1000;
  brief.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); aiButton.click(); } });
  const questions = el('div', 'tile questions'); questions.hidden = true;
  const aiButton = button('✨ AI 起草', async () => {
    if (!brief.value.trim()) { toast('先写一句想要的角色', 'error'); brief.focus(); return; }
    aiButton.disabled = true; aiButton.textContent = '起草中…';
    const r = await command({ type: 'persona.generate', brief: brief.value.trim() });
    aiButton.disabled = false; aiButton.textContent = '✨ AI 起草';
    if (!r.ok || !r.data) return;
    const { questions: asked, card: drafted, ...rest } = r.data as PersonaDraft & { questions?: unknown };
    Object.assign(draft, rest); fill();
    if (drafted && !isEmptyCard(completeCard(drafted))) { card = completeCard(drafted); buildTavern(); setMode('tavern'); }
    showQuestions(Array.isArray(asked) ? asked.filter((q): q is string => typeof q === 'string' && !!q.trim()) : []);
    toast('草稿已填好，看看哪里想改。');
  }, 'btn primary');
  ai.append(brief, aiButton);
  function showQuestions(list: string[]) {
    questions.hidden = !list.length; if (!list.length) return;
    const ul = el('ul'); for (const q of list) ul.append(el('li', '', q));
    questions.replaceChildren(el('h4', '', '下一步可以想想'), ul, el('p', 'hint', 'AI 只搭了骨架。衍生和二次解释最好由你亲手写——那是角色活过来的地方。'));
  }

  // fields shared by both modes
  const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  const bind = (key: keyof PersonaDraft, max: number, placeholder = '', rows = 0) => {
    const control = rows ? el('textarea') : el('input'); if (rows) (control as HTMLTextAreaElement).rows = rows;
    control.maxLength = max; control.placeholder = placeholder; control.oninput = () => { (draft as Record<string, unknown>)[key] = control.value; };
    inputs.set(key, control); return control;
  };
  const common = el('div', 'ed-grid');
  const petChoices = (s.pets?.catalog?.length ? s.pets.catalog : builtinPixelPets).map(p => [p.id, p.name] as [string, string]);
  // Keep a card's avatar selectable even when that sprite isn't installed here, instead of silently showing blank.
  if (draft.avatar && !petChoices.some(([id]) => id === draft.avatar)) petChoices.push([draft.avatar, `${draft.avatar}（本机未找到）`]);
  const avatar = select(draft.avatar || '', [['', '（不指定）'], ...petChoices], v => { draft.avatar = v; });
  common.append(edField('名字', bind('name', L.name, '桌宠和聊天里显示的名字')), edField('代称', bind('pronoun', L.pronoun, '她 / 他 / 它 / TA')), edField('默认小人', avatar),
    edField('一句话简介', bind('tagline', L.tagline, '显示在角色卡片上'), '', true));

  const simple = el('div', 'form-grid');
  const simpleDefs: [keyof PersonaDraft, string, string, number, number][] = [
    ['personality', '性格', '底色、优点、小缺点、情绪反应', L.personality, 4], ['speakingStyle', '说话方式', '口癖、句子长短、语气词、称呼', L.speakingStyle, 3],
    ['background', '背景设定', '来历、生活习惯、和桌面的关系', L.background, 3], ['relationship', '和你的关系', '朋友、室友、助手、搭档…', L.relationship, 0],
    ['userTitle', '对你的称呼', '留空则由相处中决定', L.userTitle, 0], ['likes', '喜好', '', L.likes, 2], ['boundaries', '边界', 'TA 不会做的事，例如不催促、不说教', L.boundaries, 2],
    ['greeting', '初见问候', '第一次被选中时说的话', L.greeting, 2], ['voiceStyle', '声音风格', '给语音合成的演绎提示', L.voiceStyle, 0],
  ];
  for (const [key, label, hint, max, rows] of simpleDefs) simple.append(field(label, bind(key, max, hint, rows), '', rows ? 'field wide' : 'field'));
  const idle = el('textarea'); idle.rows = 2; idle.placeholder = '每行一个，10 字以内，会偶尔显示在小人头顶'; idle.oninput = () => { draft.idleLines = idle.value.split('\n').map(x => x.trim()).filter(Boolean); };
  simple.append(field('发呆小词条', idle, '', 'field wide'));
  const thinking = el('textarea'); thinking.rows = 2; thinking.placeholder = '每行一个，6 字左右，例如：咬笔头、翻小本本。回复时在小人头顶轮换显示，会自动加“…”和计时'; thinking.oninput = () => { draft.thinkingLines = thinking.value.split('\n').map(x => x.trim()).filter(Boolean); };
  simple.append(field('思考小词条', thinking, '留空则只用通用词条', 'field wide'));
  const routine = el('textarea'); routine.rows = 4; routine.placeholder = `每行一个：时间 + 在做什么，例如\n07:30 起床\n12:40 午睡\n20:00 练琴\n留空则按“喜好”自动安排`;
  routine.onchange = () => { try { draft.routine = parseRoutineLines(routine.value); routine.setCustomValidity(''); } catch (error) { routine.setCustomValidity(error instanceof Error ? error.message : '日程格式无效'); routine.reportValidity(); } };
  simple.append(field('自己的小日程', routine, '小人头顶会显示 TA 正在做什么；需在「陪伴」页开启', 'field wide'));
  const fill = () => { for (const [key, control] of inputs) control.value = String((draft as Record<string, unknown>)[key] ?? ''); idle.value = (draft.idleLines || []).join('\n'); thinking.value = (draft.thinkingLines || []).join('\n'); routine.value = routineLines(draft.routine || []); avatar.value = draft.avatar || ''; };
  fill();

  const simpleHost = el('div');
  const tavern = el('div', 'stack');
  const sharedFold = el('details', 'fold'); const sharedSummary = el('summary'); sharedSummary.append('简单写法里的字段', el('small', '', '仍然生效，可留空'));
  const sharedBody = el('div', 'fold-body'); sharedFold.append(sharedSummary, sharedBody);

  // trait selects follow the palette as it changes
  const traitSyncers = new Set<() => void>();
  const syncTraits = () => { for (const sync of [...traitSyncers]) sync(); };
  function traitSelect(d: PersonaDerivation, phase?: PersonaPhase) {
    const sel = el('select'); sel.setAttribute('aria-label', '所属性格');
    const sync = () => {
      if (!sel.isConnected && sel.dataset.mounted) { traitSyncers.delete(sync); return; }
      const groups: [string, string[]][] = [['底色', card.base.trim() ? [card.base.trim()] : []], ['主色调', [...card.main, ...(phase?.main || [])]], ['点缀', [...card.accents, ...(phase?.accents || [])]]];
      sel.replaceChildren(Object.assign(el('option', '', '（选择所属性格）'), { value: '' }));
      const seen = new Set<string>();
      for (const [label, names] of groups) {
        const fresh = names.filter(n => n && !seen.has(n)); if (!fresh.length) continue;
        const group = el('optgroup'); group.label = label; for (const n of fresh) { seen.add(n); group.append(Object.assign(el('option', '', n), { value: n })); } sel.append(group);
      }
      if (d.trait && !seen.has(d.trait)) sel.append(Object.assign(el('option', '', `${d.trait}（不在调色盘里）`), { value: d.trait }));
      sel.value = d.trait;
    };
    sel.onchange = () => { d.trait = sel.value; paletteSummary(); };
    traitSyncers.add(sync); sync(); requestAnimationFrame(() => { sel.dataset.mounted = '1'; });
    return sel;
  }
  const derivationRow = (phase?: PersonaPhase) => (d: PersonaDerivation) => {
    const body = el('div', 'rep-body cols');
    body.append(traitSelect(d, phase), counted(d.text, C.item, v => { d.text = v; }, { rows: 2, placeholder: '具体场景 + 具体动作，例如：被夸的时候会立刻转移话题，但耳朵会红' }));
    return body;
  };
  const noteRow = (n: PersonaNote) => {
    const body = el('div', 'rep-body cols'), topic = el('span', 'counted'), input = el('input');
    input.maxLength = C.short; input.value = n.topic; input.placeholder = '关于…（主题）'; input.oninput = () => { n.topic = input.value; }; topic.append(input);
    body.append(topic, counted(n.text, C.long, v => { n.text = v; }, { rows: 3, placeholder: '真正的含义是…；它不是…；它在…时出现，在…时不会；和其他性格的关系…' }));
    return body;
  };
  // "温柔 2 · 嘴硬 0" — nudges toward 2–3 derivations per colour.
  const summary = el('div', 'chips');
  function paletteSummary() {
    const names = [...new Set([card.base, ...card.main, ...card.accents].map(x => x.trim()).filter(Boolean))];
    summary.replaceChildren(...names.map(n => { const k = card.derivations.filter(d => d.trait === n && d.text.trim()).length; return el('span', `pill ${k >= 2 ? 'ok' : k ? 'accent' : 'warn'}`, `${n} · ${k} 条衍生`); }));
  }

  function buildTavern() {
    traitSyncers.clear();
    const basics = edSection('基本信息', '只写偏离默认的特征——遮住名字也能认出是谁；不写“精致白皙”这类万能描写。');
    const grid = el('div', 'ed-grid');
    grid.append(edField('年龄', counted(card.age, C.short, v => { card.age = v; }, { placeholder: '例如：看起来二十出头' })), edField('性别', counted(card.gender, C.short, v => { card.gender = v; })),
      edField('身份', counted(card.identity, C.field, v => { card.identity = v; }, { placeholder: '例如：深夜便利店店员' })),
      edField('外貌特征', counted(card.appearance, C.field, v => { card.appearance = v; }, { rows: 3, placeholder: '例如：左手总缠着创可贴；说话时会无意识地转笔' }), '', true));
    basics.body.append(grid);

    const palette = edSection('性格调色盘', '每个性格 2–3 条衍生，写具体场景和动作，不写抽象定义；不通顺也没关系，那可能正是角色活过来的地方。');
    const colours = el('div', 'ed-grid');
    const onPalette = () => { syncTraits(); paletteSummary(); };
    const baseInput = counted(card.base, C.short, v => { card.base = v; onPalette(); }, { placeholder: '例如：温柔' });
    colours.append(edField('底色', baseInput, '只有一个'), edField('主色调', tagInput(card.main, 4, '回车添加，1–2 个', onPalette), '1–2 个'), edField('点缀', tagInput(card.accents, 6, '回车添加', onPalette), '可以没有'));
    palette.body.append(colours, edField('衍生', repeatable(card.derivations, { max: C.derivations, add: '添加衍生', blank: () => ({ trait: card.main[0] || card.base || '', text: '' }), row: derivationRow(), onChange: paletteSummary, label: i => `第 ${i + 1} 条衍生` }), ''), summary);
    paletteSummary();

    const lines = edSection('语料', '只写台词，不混动作和心理。AI 学的是语气，不会照着复读。');
    const lineItems = card.lines.map(text => ({ text }));
    const syncLines = () => { card.lines = lineItems.map(x => x.text); };
    lines.body.append(repeatable(lineItems, { max: C.lines, add: '添加一句台词', blank: () => ({ text: '' }), flat: true, onChange: syncLines, label: i => `第 ${i + 1} 句`, row: item => counted(item.text, C.line, v => { item.text = v; syncLines(); }, { placeholder: '例如：“……又熬夜？我才没在等你。”' }) }));

    const facets = edSection('三面性', '只有在“压力性质截然不同”的场景下行为完全不同时才需要；写怎么运作，不写为什么。', true, card.facets.length > 0 || !!card.transitions || !!card.leaks);
    facets.body.append(repeatable(card.facets, { max: C.facets, add: '添加一面', label: i => `第 ${i + 1} 面`, blank: (): PersonaFacet => ({ name: '', trigger: '', energy: '', lines: [], body: '', purpose: '' }), row: f => {
      const body = el('div', 'rep-body cols3');
      body.append(edField('名字', counted(f.name, C.short, v => { f.name = v; }, { placeholder: '例如：营业模式' })), edField('触发条件', counted(f.trigger, C.field, v => { f.trigger = v; })), edField('能量状态', counted(f.energy, C.field, v => { f.energy = v; })),
        edField('语料', linesText(f.lines, C.facetLines, v => { f.lines = v; }), '每行一句', true), edField('身体行为模式', counted(f.body, C.field, v => { f.body = v; }, { rows: 2 }), '', true), edField('功能', counted(f.purpose, C.field, v => { f.purpose = v; }, { rows: 2, placeholder: '这一面替 TA 解决了什么' }), '', true));
      return body;
    } }),
    edField('过渡', counted(card.transitions, C.long, v => { card.transitions = v; }, { rows: 2, placeholder: '从一面切到另一面时，会先出现什么信号' }), '', true),
    edField('渗透', counted(card.leaks, C.long, v => { card.leaks = v; }, { rows: 2, placeholder: '一面的习惯如何漏进另一面' }), '', true));

    const notes = edSection('二次解释', '告诉 AI “我的角色是这样的，不是你以为的那样”：真正含义、不是什么、何时出现/不出现、与其他性格的关系。');
    notes.body.append(repeatable(card.notes, { max: C.notes, add: '添加二次解释', blank: () => ({ topic: '', text: '' }), row: noteRow, label: i => `第 ${i + 1} 条解释` }));

    const current = activePhase(card, days);
    const phases = edSection('多阶段', '底色不随阶段变；阶段衍生是新出现的行为，不是上一阶段的升级版；阶段按相处天数自动切换。', true, card.phases.length > 0);
    phases.body.append(el('p', 'notice accent', `你们已相处 ${days} 天${card.phases.length ? `，现在生效的是「${current?.name || '基础调色盘'}」` : ''}。`));
    phases.body.append(repeatable(card.phases, { max: C.phases, add: '添加阶段', label: i => `第 ${i + 1} 阶段`, blank: (): PersonaPhase => ({ name: '', fromDays: (card.phases.at(-1)?.fromDays ?? 0) + 7, main: [], accents: [], derivations: [], notes: [] }), row: ph => {
      const body = el('div', 'rep-body cols2'), from = el('input'); from.type = 'number'; from.min = '0'; from.step = '1'; from.value = String(ph.fromDays);
      from.oninput = () => { ph.fromDays = Math.max(0, Math.floor(Number(from.value) || 0)); };
      const onColours = () => syncTraits();
      body.append(edField('阶段名', counted(ph.name, C.short, v => { ph.name = v; }, { placeholder: '例如：熟络之后' })), edField('从相处第 N 天起', from),
        edField('主色调', tagInput(ph.main, 4, '留空沿用基础主色调', onColours)), edField('点缀', tagInput(ph.accents, 6, '留空沿用基础点缀', onColours)),
        edField('阶段衍生', repeatable(ph.derivations, { max: C.derivations, add: '添加阶段衍生', blank: () => ({ trait: ph.main[0] || card.main[0] || '', text: '' }), row: derivationRow(ph) }), '新出现的行为', true),
        edField('阶段二次解释', repeatable(ph.notes, { max: C.notes, add: '添加阶段解释', blank: () => ({ topic: '', text: '' }), row: noteRow }), '', true));
      return body;
    } }));

    const npcs = edSection('相关人物 NPC', '只写功能需要的部分。', true, card.npcs.length > 0);
    npcs.body.append(repeatable(card.npcs, { max: C.npcs, add: '添加人物', label: i => `第 ${i + 1} 位人物`, blank: (): PersonaNpc => ({ name: '', role: '', look: '', traits: '', relation: '', lines: [] }), row: n => {
      const body = el('div', 'rep-body cols3');
      body.append(edField('名字', counted(n.name, C.short, v => { n.name = v; })), edField('身份', counted(n.role, C.field, v => { n.role = v; })), edField('外貌', counted(n.look, C.item, v => { n.look = v; })),
        edField('性格核心', counted(n.traits, C.item, v => { n.traits = v; }, { rows: 2 }), '', true), edField('与你的关系', counted(n.relation, C.item, v => { n.relation = v; }, { rows: 2 }), '', true),
        edField('语料', linesText(n.lines, 10, v => { n.lines = v; }, 2), '每行一句', true));
      return body;
    } }));

    tavern.replaceChildren(basics.box, palette.box, lines.box, notes.box, facets.box, phases.box, npcs.box, sharedFold);
  }
  buildTavern();

  function setMode(next: Mode) {
    mode = next;
    for (const t of tabButtons) t.setAttribute('aria-selected', String(t.dataset.mode === mode));
    if (mode === 'simple') simpleHost.append(simple); else sharedBody.append(simple);
    simpleHost.hidden = mode !== 'simple'; tavern.hidden = mode !== 'tavern'; scheduleMeter();
  }

  // footer: save + size meter for the structured part
  const foot = el('div', 'editor-foot row'), save = el('button', 'btn primary', '保存角色卡'); save.type = 'submit';
  const meter = el('span', 'progress meter'), bar = el('i'), size = el('small', 'hint'); meter.append(bar);
  foot.append(save, button('取消', () => form.remove(), 'btn ghost'), el('span', 'spacer'), size, meter);
  let meterFrame = 0;
  function scheduleMeter() {
    if (meterFrame) return;
    meterFrame = requestAnimationFrame(() => {
      meterFrame = 0; const empty = isEmptyCard(card), n = empty ? 0 : JSON.stringify(cleanCard(card)).length, ratio = n / C.total;
      meter.hidden = size.hidden = empty && mode === 'simple';
      size.textContent = empty ? '酒馆写法未填写' : `酒馆写法约 ${n} / ${C.total} 字`; size.style.color = ratio >= 1 ? 'var(--danger)' : ratio >= 0.85 ? 'var(--warn-text)' : '';
      bar.style.width = `${Math.min(100, Math.round(ratio * 100))}%`;
    });
  }
  form.addEventListener('input', scheduleMeter); form.addEventListener('click', () => setTimeout(scheduleMeter, 0));

  form.onsubmit = async event => {
    event.preventDefault();
    const name = String(draft.name || '').trim();
    if (!name) { toast('角色需要一个名字', 'error'); inputs.get('name')?.focus(); return; }
    const cleaned = cleanCard(card);
    if (cleaned.npcs.some(n => !n.name)) { toast('相关人物需要填写名字', 'error'); setMode('tavern'); return; }
    if (JSON.stringify(cleaned).length > C.total) { toast(`酒馆写法部分过长（上限约 ${C.total} 字）`, 'error'); return; }
    const persona: PersonaDraft = { ...draft, name }; delete persona.card;
    // An emptied card on an existing character is cleared explicitly; otherwise an empty card is simply omitted.
    if (!isEmptyCard(cleaned)) persona.card = cleaned; else if (editable && !isEmptyCard(base?.card)) persona.card = emptyCard();
    save.disabled = true;
    const r = await command({ type: 'persona.save', ...(editable ? { id: editable } : {}), persona });
    save.disabled = false;
    if (r.ok) { const id = (r.data as { id: string }).id; if (!editable) await command({ type: 'persona.select', id }); toast(editable ? '角色卡已更新。' : '新角色卡已保存并选中。'); }
  };

  form.append(head, guide, ai, questions, common, simpleHost, tavern, foot);
  setMode(mode);
  root.querySelector('.editor')?.remove();
  root.prepend(form); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); inputs.get('name')?.focus();
  return { form, setMode, toggleGuide: () => guideButton.click() };
}
