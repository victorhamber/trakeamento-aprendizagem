import { describe, it, expect } from 'vitest';
import vm from 'vm';
import router from './sdk';

type Layer = { route?: { path: string; stack: Array<{ handle: Function }> } };

async function renderTracker(): Promise<string> {
  const layer = (router as unknown as { stack: Layer[] }).stack.find(
    (l) => l.route?.path === '/tracker.js'
  );
  if (!layer?.route) throw new Error('rota /tracker.js não encontrada');
  const handler = layer.route.stack[0].handle;
  let body = '';
  const res = {
    setHeader: () => res,
    status: () => res,
    type: () => res,
    send: (b: string) => {
      body = b;
      return res;
    },
  };
  const req = {
    query: {},
    headers: { host: 'api.trajettu.com' },
    protocol: 'https',
    get: (h: string) => (h.toLowerCase() === 'host' ? 'api.trajettu.com' : undefined),
  };
  await handler(req, res);
  return body;
}

describe('tracker.js', () => {
  it('gera JavaScript válido com a espera do configurador da Meta', async () => {
    const js = await renderTracker();
    expect(js).toContain('__TA_META_PB_WHEN_READY');
    expect(js).toContain('shouldWaitForMetaClickRecovery');
    expect(() => new vm.Script(js)).not.toThrow();
  });

  it('mantém os escapes de regex no JavaScript servido', async () => {
    const js = await renderTracker();
    expect(js).not.toMatch(/\/s\+\/g/);
    expect(js).not.toContain('[^p{L}p{N}s]');
    expect(js).toContain('/\\s+/g');
    expect(js).toContain('/[^\\p{L}\\p{N}\\s]/gu');
  });

  it('normaliza estado e valor como o navegador vai executar', async () => {
    const js = await renderTracker();
    const pick = (name: string) => {
      const start = js.indexOf(`function ${name}(`);
      if (start < 0) throw new Error(`${name} não encontrada`);
      let depth = 0;
      for (let i = js.indexOf('{', start); i < js.length; i++) {
        if (js[i] === '{') depth++;
        else if (js[i] === '}' && --depth === 0) return js.slice(start, i + 1);
      }
      throw new Error(`${name} incompleta`);
    };
    const ctx: Record<string, unknown> = {};
    vm.runInNewContext(`${pick('normState')}\n${pick('parseMoney')}\nout = { normState, parseMoney };`, ctx);
    const { normState, parseMoney } = ctx.out as {
      normState: (v: string) => string;
      parseMoney: (v: unknown) => number;
    };
    expect(normState('São Paulo')).toBe('sp');
    expect(normState('Santa Catarina')).toBe('sc');
    expect(normState('Mato Grosso do Sul')).toBe('ms');
    expect(parseMoney('1.297')).toBe(1297);
    expect(parseMoney('1.297,50')).toBe(1297.5);
    expect(parseMoney('97,50')).toBe(97.5);
    expect(parseMoney('9.99')).toBe(9.99);
    expect(parseMoney(747)).toBe(747);
  });
});
