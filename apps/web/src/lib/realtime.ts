import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { getAccessToken } from './api';
import { useAuth } from './auth';

const SOUND_KEY = 'oc.queue.sound';

export function soundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) === '1';
  } catch {
    return false;
  }
}
export function setSoundEnabled(v: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 880;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.15);
  } catch {
    /* sem áudio */
  }
}

/**
 * Socket.IO autenticado: eventos apenas invalidam consultas (REST é a fonte
 * da verdade). Na reconexão, tudo é recarregado.
 */
export function useRealtime() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const tenantId = me?.current?.tenant.id;
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!tenantId || me?.current?.supportAccess) return;
    const s = io({ path: '/api/v1/realtime', transports: ['websocket', 'polling'], auth: (cb) => cb({ token: getAccessToken() }) });
    socketRef.current = s;
    let wasDisconnected = false;
    s.on('connect', () => {
      if (wasDisconnected) void qc.invalidateQueries();
      wasDisconnected = false;
    });
    s.on('disconnect', () => (wasDisconnected = true));
    s.on('os.created', (p: { number: number }) => {
      void qc.invalidateQueries({ queryKey: ['service-orders'] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (window.location.pathname.startsWith('/app/technician')) {
        toast.info(`Nova OS nº ${p.number} na fila`);
        if (soundEnabled()) beep();
      }
    });
    s.on('os.updated', (p: { id: string }) => {
      void qc.invalidateQueries({ queryKey: ['service-orders'] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['os', p.id] });
    });
    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, [tenantId, qc, me?.current?.supportAccess]);
}
