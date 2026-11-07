import { randomUUID } from 'node:crypto';
import type { MainToolDeps } from './main-tools';
import type { ModelGateway } from './model-gateway';
import type { Brief } from './helpers';
import type { HelperOptions } from './helper-runner';
import { abortableDelay, type PoolPriority } from './pool';
import {
  PLAN_PROMPT,
  RESEARCH_PROMPT,
  RESEARCH_LIMITS,
  pickInterest,
  parsePlan,
  mergePlan,
  feedbackSummary,
  anglesFor,
  canRun,
  addFindings,
  parseFindings,
  type ResearchLedger,
  type Signals,
} from './research';

type ResearchOptions = {
  gateway: ModelGateway;
  web(signal: AbortSignal): MainToolDeps['web'];
  ledger(): ResearchLedger;
  save(next: ResearchLedger): void;
  prepare(): Promise<void>;
  signals(now: number): Signals;
  blocked(): boolean;
  busy(): boolean;
  changed(): void;
  helper(goal: string, signal: AbortSignal, priority: PoolPriority, options: HelperOptions): Promise<Brief>;
};

// One research pass shares public reads across its helpers. No cache survives into another user request.
export function shareResearchWeb(web: NonNullable<MainToolDeps['web']>): NonNullable<MainToolDeps['web']> {
  const pages = new Map<string, ReturnType<typeof web.read>>();
  const searches = new Map<string, ReturnType<typeof web.search>>();
  return {
    read(url) {
      let read = pages.get(url);
      if (!read) {
        read = web.read(url);
        pages.set(url, read);
      }
      return read;
    },
    search(query, limit) {
      const key = JSON.stringify([query.trim(), limit]);
      let search = searches.get(key);
      if (!search) {
        search = web.search(query, limit);
        searches.set(key, search);
      }
      return search;
    },
  };
}

export class ResearchRunner {
  private active?: AbortController;
  private researchBackoffUntil = 0;
  constructor(private options: ResearchOptions) {}
  get running() {
    return !!this.active;
  }
  cancel() {
    this.active?.abort();
  }
  async step(now: number, force = false) {
    if (
      this.running ||
      this.options.blocked() ||
      (!force && (this.options.busy() || now < this.researchBackoffUntil))
    )
      return;
    const ledger = this.options.ledger();
    if (
      !force &&
      now - ledger.lastPlanAt <= RESEARCH_LIMITS.planEveryMs &&
      (!canRun(ledger, now) || !pickInterest(ledger, now))
    )
      return;
    // Claim the slot before scanning: a manual run and a heartbeat can arrive together.
    const controller = new AbortController();
    this.active = controller;
    try {
      await this.options.prepare();
      if (controller.signal.aborted || this.options.blocked() || (!force && this.options.busy())) return;
      await this.research(now, force, controller);
    } catch {
      if (!controller.signal.aborted) this.researchBackoffUntil = now + 15 * 60000;
    } finally {
      this.active = undefined;
    }
  }
  private async waitForConversation(signal: AbortSignal) {
    while (this.options.busy() && !this.options.blocked()) await abortableDelay(500, signal);
    signal.throwIfAborted();
  }
  private async research(now: number, force: boolean, controller: AbortController) {
    const signals = this.options.signals(now);
    const hasSignals = Object.keys(signals.counts).length > 0;
    const planDue =
      hasSignals &&
      (now - this.options.ledger().lastPlanAt > RESEARCH_LIMITS.planEveryMs ||
        (force && !this.options.ledger().interests.length));
    if (!planDue && !(force || canRun(this.options.ledger(), now))) return;

    if (planDue) {
      const { counts: _c, ...data } = signals;
      const raw = await this.options.gateway.request(
        [
          { role: 'system', content: PLAN_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              now: new Date(now).toISOString(),
              signals: data,
              feedback: feedbackSummary(this.options.ledger()),
            }),
          },
        ],
        controller.signal,
        'background',
        undefined,
        undefined,
        false,
        'research',
      );
      if (controller.signal.aborted || this.options.blocked()) return;
      const plan = parsePlan(raw);
      plan.interests = plan.interests
        .map((candidate) => ({
          ...candidate,
          sources: candidate.sources.filter(
            (channel) =>
              !!signals.counts[channel] &&
              (channel !== 'manual' ||
                this.options
                  .ledger()
                  .interests.some((i) => i.topic === candidate.topic && i.sources.includes('manual'))),
          ),
        }))
        .filter((candidate) => candidate.sources.length > 0);
      this.options.save(mergePlan(this.options.ledger(), plan, now, randomUUID));
      this.researchBackoffUntil = 0;
      this.options.changed();
      if (!force) return; // planning is this step's work; research waits for the next tick
    }
    const interest = pickInterest(this.options.ledger(), now);
    if (!interest) return;

    // One helper per angle, side by side: each reads its own pages and hands back points + sources only.
    const earlier = this.options
      .ledger()
      .findings.filter((f) => f.interestId === interest.id)
      .slice(0, 5)
      .map((f) => ({ title: f.title, detail: f.summary, shared: !!f.sharedAt }));
    const availableWeb = this.options.web(controller.signal);
    if (!availableWeb) return;
    const web = shareResearchWeb(availableWeb);
    const angles = anglesFor(interest, this.options.ledger().runs.length);
    const briefs = await Promise.all(
      angles.map((a) =>
        this.options.helper(
          `研究「${interest.topic}」，角度：${a.angle}。从搜索「${a.query}」开始，读 2–3 个不同网站的原文，整理用户可能在意的具体新信息（时间、数字、名字、价格），每条附上来源网址。earlier 是上次查到的内容，没有新进展就直说，不换个标题重讲。`,
          controller.signal,
          'background',
          {
            tools: ['web_search', 'read_webpage'],
            web,
            rounds: 4,
            by: 'research',
            context: { interest: { topic: interest.topic, why: interest.why }, earlier },
          },
        ),
      ),
    );
    if (controller.signal.aborted || this.options.blocked()) return;
    const urls = new Set(briefs.flatMap((b) => b.sources.map((x) => x.url)));
    if (
      !this.options
        .ledger()
        .interests.some((i) => i.id === interest.id && !(i.restUntil && i.restUntil > now))
    )
      return;
    if (!urls.size) {
      this.options.save(addFindings(this.options.ledger(), interest.id, [], now));
      return;
    }
    const material = briefs.map((b, i) => ({
      angle: angles[i].angle,
      gist: b.gist,
      points: b.points,
      sources: b.sources,
      gaps: b.gaps,
    }));
    await this.waitForConversation(controller.signal);
    if (this.options.blocked()) return;
    const raw = await this.options.gateway.request(
      [
        { role: 'system', content: RESEARCH_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            interest: { topic: interest.topic, why: interest.why, kind: interest.kind },
            today: new Date(now).toISOString().slice(0, 10),
            earlier,
            material,
          }),
        },
      ],
      controller.signal,
      'background',
      undefined,
      undefined,
      false,
      'research',
    );
    if (controller.signal.aborted || this.options.blocked()) return;
    this.options.save(
      addFindings(
        this.options.ledger(),
        interest.id,
        parseFindings(raw, interest, angles.map((a) => a.angle).join(' · '), urls, now, randomUUID),
        now,
      ),
    );
    this.researchBackoffUntil = 0;
    this.options.changed();
  }
}
