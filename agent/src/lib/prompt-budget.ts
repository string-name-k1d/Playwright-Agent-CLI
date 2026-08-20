export function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function truncateForPrompt(text: string, maxChars: number, label: string): string {
  if (!text || text.length <= maxChars) return text;
  const tail = `\n\n[${label} truncated to ${maxChars} chars from ${text.length}]`;
  const keep = Math.max(0, maxChars - tail.length);
  return text.slice(0, keep) + tail;
}
