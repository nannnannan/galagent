export const estimateTokens = (s: string) =>
  Math.ceil([...s].reduce((n, c) => n + (/[^\x00-\x7F]/.test(c) ? 1 : 0.3), 0));
