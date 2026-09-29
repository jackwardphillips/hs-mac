// Deliberately conservative: uncertain semantic alternatives stay with the host.
export function softMatch(actual, expected) {
  const normalize = (s) => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^(who|what|where)\s+(is|are|was|were)\s+/, '').replace(/[^a-z0-9\s]/g, '').replace(/^(a|an|the)\s+/, '').replace(/\s+/g, ' ').trim();
  const a = normalize(actual), b = normalize(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  if (/\d/.test(a + b) || Math.min(a.length, b.length) < 5) return false;
  let row = Array.from({length:b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j-1]+1, row[j]+1, row[j-1]+(a[i-1] === b[j-1] ? 0 : 1));
    row = next;
  }
  return row[b.length] <= (Math.min(a.length, b.length) >= 12 ? 2 : 1);
}
