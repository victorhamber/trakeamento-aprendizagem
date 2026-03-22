/** Som curto estilo “caixa registradora” (sintético — não é áudio da Hotmart). */

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new Ctx();
  }
  return sharedCtx;
}

export async function playSaleChime(): Promise<void> {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return;
    }
  }

  const now = ctx.currentTime;
  const freqs = [1318, 1047, 1568];
  const gains = [0.14, 0.11, 0.1];

  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(g);
    g.connect(ctx.destination);
    const t0 = now + i * 0.07;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gains[i], t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  });
}
