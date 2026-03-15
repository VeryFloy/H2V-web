const WAVE_BARS = 48;
const waveformCache = new Map<string, number[]>();
const durationCache = new Map<string, number>();

export function fallbackWaveform(seed: string): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < WAVE_BARS; i++) {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    bars.push(0.10 + (hash % 80) / 100);
  }
  return bars;
}

export function getCachedDuration(url: string): number {
  return durationCache.get(url) || 0;
}

export async function extractWaveform(url: string, barCount: number = WAVE_BARS): Promise<number[]> {
  if (waveformCache.has(url)) return waveformCache.get(url)!;
  const resp = await fetch(url, { credentials: 'include' });
  const buf = await resp.arrayBuffer();
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    const decoded = await ctx.decodeAudioData(buf);
    if (decoded.duration && isFinite(decoded.duration)) {
      durationCache.set(url, decoded.duration);
    }
    const raw = decoded.getChannelData(0);
    const step = Math.floor(raw.length / barCount);
    const peaks: number[] = [];
    for (let i = 0; i < barCount; i++) {
      let peak = 0;
      const end = Math.min((i + 1) * step, raw.length);
      for (let j = i * step; j < end; j++) {
        const v = Math.abs(raw[j]);
        if (v > peak) peak = v;
      }
      peaks.push(peak);
    }
    const maxPeak = Math.max(...peaks, 0.001);
    const normalized = peaks.map(p => Math.max(0.06, p / maxPeak));
    waveformCache.set(url, normalized);
    return normalized;
  } finally {
    await ctx.close();
  }
}

export { WAVE_BARS };
