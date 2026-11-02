// 分几条发 (活人感): a reply written as a few short paragraphs (blank-line separated) is shown as separate
// chat bubbles, typed out one after another. Long explanations, lists and code stay a single message.
export const MAX_PARTS = 3, MAX_PART_CHARS = 140;
const structured = /```|^\s*(?:[-*+]|\d+[.)、])\s|^\s*#|\|.*\|/m;

/** 2–3 short parts, or undefined to keep the reply whole. */
export function splitReply(text: string): string[] | undefined {
  if (structured.test(text)) return undefined;
  const parts = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return undefined;
  const merged = parts.length > MAX_PARTS ? [...parts.slice(0, MAX_PARTS - 1), parts.slice(MAX_PARTS - 1).join('\n')] : parts;
  if (merged.some(p => [...p].length > MAX_PART_CHARS)) return undefined;
  return merged;
}
/** Typing time before a part appears: grows with its length, 0.7–2.4 s. */
export const typingDelay = (part: string) => Math.min(2400, 700 + [...part].length * 45);
