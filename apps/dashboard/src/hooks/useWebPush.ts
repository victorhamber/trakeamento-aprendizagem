import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { playSaleChime } from '../lib/playSaleChime';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

export function useWebPush(isAuthed: boolean) {
  const [supported, setSupported] = useState(false);
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const regRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window);
  }, []);

  useEffect(() => {
    if (!isAuthed || !supported) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'trajettu-sale') {
        void playSaleChime();
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [isAuthed, supported]);

  const refreshServerState = useCallback(async () => {
    try {
      const { data } = await api.get<{ enabled: boolean; publicKey: string | null }>('/mobile/web-push-config');
      setServerEnabled(!!data?.enabled);
      return data;
    } catch {
      setServerEnabled(false);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!isAuthed || !supported) return;
    void refreshServerState();
  }, [isAuthed, supported, refreshServerState]);

  // Sincroniza estado de subscription local
  useEffect(() => {
    if (!isAuthed || !supported) return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (cancelled) return;
        regRef.current = reg;
        const sub = await reg.pushManager.getSubscription();
        setSubscribed(!!sub);
      } catch {
        setSubscribed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthed, supported, serverEnabled]);

  const subscribe = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const cfg = await refreshServerState();
      if (!cfg?.enabled || !cfg.publicKey) {
        setError('Configure VAPID na API (WEB_PUSH_VAPID_*).');
        return;
      }

      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      regRef.current = reg;
      await reg.update();

      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await api.post('/mobile/register-web-push', { subscription: existing.toJSON() });
        setSubscribed(true);
        await playSaleChime();
        return;
      }

      const key = urlBase64ToUint8Array(cfg.publicKey);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
      });

      await api.post('/mobile/register-web-push', { subscription: sub.toJSON() });
      setSubscribed(true);
      await playSaleChime();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : 'Falha ao ativar alertas.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [refreshServerState]);

  const unsubscribe = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const reg = regRef.current || (await navigator.serviceWorker.ready);
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const ep = sub.endpoint;
        await sub.unsubscribe();
        await api.post('/mobile/unregister-web-push', { endpoint: ep });
      }
      setSubscribed(false);
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : 'Falha ao desativar.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    supported,
    serverEnabled,
    subscribed,
    busy,
    error,
    subscribe,
    unsubscribe,
    refreshServerState,
  };
}
