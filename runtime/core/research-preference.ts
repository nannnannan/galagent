import { addManual, removeInterest, FEEDBACK, type ResearchLedger } from './research';

type Preference = { action: 'follow' | 'pause' | 'forget'; topic: string };

// Match a direct request, not a quotation, question, condition or a whole paragraph.
// Free conversation continues through the ordinary chat path.
export function researchPreference(text: string): Preference | undefined {
  const line = text
    .trim()
    .replace(/[。！!]$/, '')
    .trim();
  if (/[，,。；;！？?!“”「」\n]/.test(line)) return;
  const rules = [
    ['forget', /^(?:请)?(?:取消关注|不用再关注)\s*(.+?)(?:了)?$/u],
    ['pause', /^(?:最近|暂时)?(?:先别聊|先不聊|先别提)\s*(.+?)(?:了)?$/u],
    ['follow', /^(?:请)?(?:帮我留意|帮我关注|继续关注)(?:一下)?\s*(.+?)$/u],
  ] as const;
  for (const [action, pattern] of rules) {
    const topic = pattern.exec(line)?.[1].trim();
    if (!topic || topic.length > 40 || /^(?:这|那)(?:个|件事|事|话题)?(?:了)?$/.test(topic)) continue;
    return { action, topic };
  }
}

export function changeResearchPreference(
  ledger: ResearchLedger,
  request: Preference,
  now: number,
  id: () => string,
) {
  const { action, topic } = request;
  if (action === 'follow')
    return {
      ledger: addManual(ledger, topic, now, id),
      receipt: { topic, result: '已记为用户亲自指定的兴趣；后续按研究设置查找，有值得说的再分享。' },
    };
  const interest = ledger.interests.find((i) => i.topic.trim().toLowerCase() === topic.toLowerCase());
  if (!interest) return { ledger, receipt: { topic, result: '没有找到这个名称的已记录兴趣。' } };
  if (action === 'forget')
    return {
      ledger: removeInterest(ledger, interest.id),
      receipt: { topic, result: '已取消关注，并移除该兴趣的研究笔记。' },
    };
  const ids = new Set(ledger.findings.filter((f) => f.interestId === interest.id).map((f) => f.id));
  return {
    ledger: {
      ...ledger,
      interests: ledger.interests.map((i) =>
        i.id === interest.id ? { ...i, restUntil: now + FEEDBACK.restMs } : i,
      ),
      pendingShare: ledger.pendingShare?.ids.some((fid) => ids.has(fid)) ? undefined : ledger.pendingShare,
      thread: ledger.thread && ids.has(ledger.thread.findingId) ? undefined : ledger.thread,
    },
    receipt: { topic, result: '已暂缓研究与分享两周；用户明确要求继续关注即可恢复。' },
  };
}
