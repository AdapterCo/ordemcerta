import { useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@ordemcerta/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, setAccessToken, setOnSessionLost } from './api';

export interface Me {
  user: { id: string; name: string; email: string; platformRole: 'PLATFORM_SUPERADMIN' | null; mfaEnabled: boolean; mfaVerified: boolean };
  tenants: Array<{ tenantId: string; name: string; status: string; role: string }>;
  current: null | {
    tenant: { id: string; name: string; timezone: string; primaryColor: string | null; onboardingCompletedAt: string | null; status: string };
    role: string | null;
    supportAccess: boolean;
    permissions: Permission[];
    allBranches: boolean;
    branches: Array<{ id: string; name: string; timezone: string }>;
    technicianBranchIds: string[];
    subscription: null | {
      status: string;
      operational: boolean;
      paymentMode: string;
      planCode: string;
      planName: string;
      currentPeriodEnd: string | null;
      graceUntil: string | null;
    };
  };
}

export type LoginStep = 'mfa_required' | 'mfa_setup_required' | 'password_change_required';
export type LoginOutcome = { status: 'authenticated' } | { status: LoginStep; mfaToken: string };

interface AuthState {
  me: Me | null;
  loading: boolean;
  branchId: string | null;
  setBranchId: (id: string | null) => void;
  can: (p: Permission) => boolean;
  login: (email: string, password: string) => Promise<LoginOutcome>;
  completeSession: (accessToken: string) => Promise<void>;
  logout: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const BRANCH_KEY = 'oc.branch';

function readBranch(): string | null {
  try {
    return localStorage.getItem(BRANCH_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [branchId, setBranchIdState] = useState<string | null>(readBranch());

  const reload = useCallback(async () => {
    try {
      setMe(await api<Me>('/auth/me'));
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    setOnSessionLost(() => {
      setAccessToken(null);
      setMe(null);
    });
    (async () => {
      if (await refreshSession()) await reload();
      setLoading(false);
    })();
  }, [reload]);

  // Filial selecionada precisa ser uma das autorizadas.
  useEffect(() => {
    const branches = me?.current?.branches ?? [];
    if (branches.length && (!branchId || !branches.some((b) => b.id === branchId))) {
      setBranchIdState(branches[0]!.id);
    }
  }, [me, branchId]);

  const setBranchId = useCallback((id: string | null) => {
    setBranchIdState(id);
    try {
      if (id) localStorage.setItem(BRANCH_KEY, id);
    } catch {
      /* armazenamento indisponível */
    }
  }, []);

  const completeSession = useCallback(
    async (token: string) => {
      setAccessToken(token);
      await reload();
    },
    [reload],
  );

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      const r = await api<{ status: string; accessToken?: string; mfaToken?: string }>('/auth/login', { method: 'POST', body: { email, password } });
      if (r.status === 'authenticated' && r.accessToken) {
        await completeSession(r.accessToken);
        return { status: 'authenticated' };
      }
      return { status: r.status as LoginStep, mfaToken: r.mfaToken! };
    },
    [completeSession],
  );

  const logout = useCallback(async () => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('oc_csrf='))?.slice(8);
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include', headers: csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {} }).catch(() => undefined);
    setAccessToken(null);
    setMe(null);
    qc.clear();
  }, [qc]);

  const switchTenant = useCallback(
    async (tenantId: string) => {
      const r = await api<{ accessToken: string }>('/auth/switch-tenant', { method: 'POST', body: { tenantId } });
      setAccessToken(r.accessToken);
      qc.clear();
      await reload();
    },
    [qc, reload],
  );

  const value = useMemo<AuthState>(() => {
    const perms = new Set(me?.current?.permissions ?? []);
    return { me, loading, branchId, setBranchId, can: (p) => perms.has(p), login, completeSession, logout, switchTenant, reload };
  }, [me, loading, branchId, setBranchId, login, completeSession, logout, switchTenant, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider ausente');
  return c;
}
