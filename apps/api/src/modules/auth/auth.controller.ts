import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaEnableSchema,
  mfaVerifySchema,
  resetPasswordSchema,
  switchTenantSchema,
} from '@ordemcerta/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { auth } from '../../core/context';
import { NoTenant, Public } from '../../core/decorators';
import { ENV, type AppEnv } from '../../core/env.provider';
import { Doc, ZBody } from '../../core/zod';
import { AuthService, type IssuedSession } from './auth.service';
import { assertCsrf, clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './cookies';

const mfaTokenSchema = z.object({ mfaToken: z.string().min(10).max(2000) });
const tokenOnlySchema = z.object({ token: z.string().min(20).max(200) });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  private issue(res: Response, s: IssuedSession) {
    const csrfToken = setAuthCookies(res, this.env, s.refreshToken);
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, csrfToken };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @Doc('Login com e-mail e senha', { body: loginSchema })
  async login(@ZBody(loginSchema) body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(body.email, body.password);
    if (r.kind === 'session') return { status: 'authenticated', ...this.issue(res, r) };
    return { status: r.kind, mfaToken: r.mfaToken };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/verify')
  @HttpCode(200)
  @Doc('Conclui o login com código TOTP', { body: mfaVerifySchema })
  async mfaVerify(@ZBody(mfaVerifySchema) body: z.infer<typeof mfaVerifySchema>, @Res({ passthrough: true }) res: Response) {
    return { status: 'authenticated', ...this.issue(res, await this.auth.verifyMfa(body.mfaToken, body.code)) };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/setup-required/start')
  @HttpCode(200)
  @Doc('Configuração obrigatória de MFA (plataforma) — gera segredo', { body: mfaTokenSchema })
  mfaSetupStart(@ZBody(mfaTokenSchema) body: z.infer<typeof mfaTokenSchema>) {
    return this.auth.mfaSetupWithToken(body.mfaToken);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/setup-required/enable')
  @HttpCode(200)
  @Doc('Configuração obrigatória de MFA — confirma código e abre sessão', { body: mfaVerifySchema })
  async mfaSetupEnable(@ZBody(mfaVerifySchema) body: z.infer<typeof mfaVerifySchema>, @Res({ passthrough: true }) res: Response) {
    return { status: 'authenticated', ...this.issue(res, await this.auth.mfaEnableWithToken(body.mfaToken, body.code)) };
  }

  @ApiBearerAuth()
  @NoTenant()
  @Post('mfa/setup')
  @HttpCode(200)
  @Doc('Inicia MFA opcional para o usuário autenticado')
  mfaSetup() {
    return this.auth.mfaSetup(auth().userId);
  }

  @ApiBearerAuth()
  @NoTenant()
  @Post('mfa/enable')
  @HttpCode(204)
  @Doc('Habilita MFA', { body: mfaEnableSchema })
  async mfaEnable(@ZBody(mfaEnableSchema) body: z.infer<typeof mfaEnableSchema>) {
    await this.auth.mfaEnable(auth().userId, body.code);
  }

  @ApiBearerAuth()
  @NoTenant()
  @Post('mfa/disable')
  @HttpCode(204)
  @Doc('Desabilita MFA (não permitido para a plataforma)', { body: mfaEnableSchema })
  async mfaDisable(@ZBody(mfaEnableSchema) body: z.infer<typeof mfaEnableSchema>) {
    await this.auth.mfaDisable(auth().userId, body.code);
  }

  /** Cookie HttpOnly + CSRF double-submit. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  @Doc('Renova o access token (refresh rotativo via cookie)')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertCsrf(req, this.env);
    try {
      return this.issue(res, await this.auth.refresh((req.cookies as Record<string, string>)?.[REFRESH_COOKIE]));
    } catch (e) {
      clearAuthCookies(res, this.env);
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @Doc('Encerra a sessão atual')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertCsrf(req, this.env);
    await this.auth.logoutByRefresh((req.cookies as Record<string, string>)?.[REFRESH_COOKIE]);
    clearAuthCookies(res, this.env);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(202)
  @Doc('Solicita redefinição de senha (resposta idêntica para qualquer e-mail)', { body: forgotPasswordSchema })
  async forgot(@ZBody(forgotPasswordSchema) body: z.infer<typeof forgotPasswordSchema>) {
    await this.auth.forgotPassword(body.email);
    return { message: 'Se o e-mail estiver cadastrado, enviaremos as instruções.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(204)
  @Doc('Redefine a senha com token de uso único', { body: resetPasswordSchema })
  async reset(@ZBody(resetPasswordSchema) body: z.infer<typeof resetPasswordSchema>) {
    await this.auth.resetPassword(body.token, body.password);
  }

  @ApiBearerAuth()
  @NoTenant()
  @Post('change-password')
  @HttpCode(204)
  @Doc('Altera a senha (encerra as demais sessões)', { body: changePasswordSchema })
  async changePassword(@ZBody(changePasswordSchema) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(body.currentPassword, body.newPassword);
  }

  @ApiBearerAuth()
  @NoTenant()
  @Get('me')
  @Doc('Usuário, empresas e contexto atual (permissões, filiais, assinatura)')
  me() {
    return this.auth.me();
  }

  @ApiBearerAuth()
  @NoTenant()
  @Post('switch-tenant')
  @HttpCode(200)
  @Doc('Troca a empresa ativa da sessão', { body: switchTenantSchema })
  switchTenant(@ZBody(switchTenantSchema) body: z.infer<typeof switchTenantSchema>) {
    return this.auth.switchTenant(body.tenantId);
  }

  @ApiBearerAuth()
  @NoTenant()
  @Get('sessions')
  @Doc('Sessões ativas do usuário')
  sessions() {
    return this.auth.listSessions(auth().userId);
  }

  @ApiBearerAuth()
  @NoTenant()
  @Delete('sessions/:id')
  @HttpCode(204)
  @Doc('Revoga uma sessão')
  async revoke(@Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(auth().userId, id);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('invitations/preview')
  @HttpCode(200)
  @Doc('Dados públicos do convite', { body: tokenOnlySchema })
  previewInvitation(@ZBody(tokenOnlySchema) body: z.infer<typeof tokenOnlySchema>) {
    return this.auth.previewInvitation(body.token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('invitations/accept')
  @HttpCode(200)
  @Doc('Aceita convite (cria acesso se necessário)', { body: acceptInvitationSchema })
  async acceptInvitation(@Body() raw: unknown, @Res({ passthrough: true }) res: Response) {
    const body = acceptInvitationSchema.parse(raw);
    return { status: 'authenticated', ...this.issue(res, await this.auth.acceptInvitation(body.token, body.name, body.password)) };
  }
}
