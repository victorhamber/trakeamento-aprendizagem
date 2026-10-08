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
});
