import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { ENV, type AppEnv } from './env.provider';
import { Errors } from './errors';

export interface AccessClaims {
  sub: string;
  sid: string;
  tid: string | null;
}

const ISSUER = 'ordemcerta';

export type LoginStepPurpose = 'verify' | 'setup' | 'password';

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) private readonly env: AppEnv) {
    this.key = new TextEncoder().encode(env.JWT_SECRET);
  }

  async signAccess(c: AccessClaims): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = this.env.ACCESS_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({ sid: c.sid, tid: c.tid, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.sub)
      .setIssuer(ISSUER)
      .setAudience('api')
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(this.key);
    return { token, expiresIn };
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: 'api', algorithms: ['HS256'] });
      if (payload.typ !== 'access' || !payload.sub || typeof payload.sid !== 'string') throw new Error();
      return { sub: payload.sub, sid: payload.sid, tid: (payload.tid as string | null) ?? null };
    } catch {
      throw Errors.unauthenticated('Sessão expirada');
    }
  }

  /** Token curto da etapa pós-senha: MFA (verificação/configuração) ou troca obrigatória de senha. */
  async signMfa(userId: string, purpose: LoginStepPurpose): Promise<string> {
    return new SignJWT({ typ: 'mfa', purpose })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience('mfa')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.key);
  }

  async verifyMfa(token: string): Promise<{ userId: string; purpose: LoginStepPurpose }> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: 'mfa', algorithms: ['HS256'] });
      if (payload.typ !== 'mfa' || !payload.sub) throw new Error();
      const purpose: LoginStepPurpose = payload.purpose === 'setup' ? 'setup' : payload.purpose === 'password' ? 'password' : 'verify';
      return { userId: payload.sub, purpose };
    } catch {
      throw Errors.unauthenticated('Etapa de verificação expirada; faça login novamente');
    }
  }
}
