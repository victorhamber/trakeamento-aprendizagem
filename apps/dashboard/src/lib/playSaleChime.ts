/** Som de “caixa” ao receber alerta de venda (arquivo em /public/sounds). */

function saleSoundSrc(): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${base}/sounds/sale-ka-ching.mp3`;
}

export async function playSaleChime(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const audio = new Audio(saleSoundSrc());
    audio.volume = 1;
    await audio.play();
  } catch {
    /* autoplay ou recurso bloqueado */
  }
}
