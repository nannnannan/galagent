import type { UsageCategory, UsageView } from '../shared/contracts';
import { localDay } from './daily';
import type { Store } from './store';

const USAGE_DAYS = 30;

export class UsageLedger {
  constructor(private store: Store) {}
  load() {
    this.ledger = this.store.get<typeof this.ledger>('usage') || {};
  }
  private ledger: Record<string, Partial<Record<UsageCategory, number>>> = {};
  record(category: UsageCategory, tokens: number) {
    if (!(tokens > 0)) return;
    const day = localDay(Date.now()),
      today = this.ledger[day] || {};
    this.ledger = Object.fromEntries(
      Object.entries({ ...this.ledger, [day]: { ...today, [category]: (today[category] || 0) + tokens } })
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-USAGE_DAYS),
    );
    this.store.put('state', 'usage', this.ledger);
  }
  view(): UsageView {
    return {
      today: this.ledger[localDay(Date.now())] || {},
      days: Object.entries(this.ledger)
        .slice(-7)
        .map(([day, u]) => ({ day, total: Object.values(u).reduce((n, v) => n + (v || 0), 0) })),
    };
  }
}
