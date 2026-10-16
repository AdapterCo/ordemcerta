import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { branchRoom } from '@ordemcerta/server';
import type { Server, Socket } from 'socket.io';
import { SystemPrisma } from './database';
import { AuthResolver } from './guards';
import { TokenService, type AccessClaims } from './token.service';

const REVALIDATE_MS = 60_000;

/**
 * Socket.IO autenticado. Rooms `tenant:<id>:branch:<id>`: o cliente só entra
 * nas filiais autorizadas. Eventos são apenas sinais (ids/status); o cliente
 * sempre refaz a consulta REST — websocket não é fonte da verdade.
 */
@WebSocketGateway({
  path: '/api/v1/realtime',
  cors: { origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()), credentials: true },
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger('Realtime');
  private revalidateTimer?: NodeJS.Timeout;

  constructor(
    private readonly tokens: TokenService,
    private readonly resolver: AuthResolver,
    private readonly system: SystemPrisma,
  ) {}

  onModuleInit() {
    this.revalidateTimer = setInterval(() => void this.revalidate(), REVALIDATE_MS);
    this.revalidateTimer.unref();
  }

  onModuleDestroy() {
    if (this.revalidateTimer) clearInterval(this.revalidateTimer);
  }

  /**
   * Sessão revogada, usuário desativado ou acesso à empresa removido depois da conexão:
   * derruba o socket (a conexão só era validada no handshake).
   */
  private async revalidate() {
    const sockets = this.server?.sockets?.sockets;
    if (!sockets?.size) return;
    for (const client of sockets.values()) {
      const claims = (client.data as { claims?: AccessClaims } | undefined)?.claims;
      if (!claims) continue;
      try {
        const a = await this.resolver.resolve(claims);
        if (!a.tenantId || a.supportAccess) throw new Error('sem empresa');
      } catch {
        client.disconnect(true);
      }
    }
  }

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth as { token?: string } | undefined)?.token;
      if (!token) throw new Error('sem token');
      const claims = await this.tokens.verifyAccess(token);
      const a = await this.resolver.resolve(claims);
      if (!a.tenantId || a.supportAccess) throw new Error('sem empresa');
      const branchIds = a.allBranches
        ? (await this.system.branch.findMany({ where: { tenantId: a.tenantId, status: 'ACTIVE' }, select: { id: true } })).map((b) => b.id)
        : a.branchIds;
      await client.join(branchIds.map((b) => branchRoom(a.tenantId!, b)));
      await client.join(`tenant:${a.tenantId}:user:${a.userId}`);
      client.data = { tenantId: a.tenantId, userId: a.userId, branchIds, claims };
      client.emit('ready', { branchIds });
    } catch (e) {
      this.logger.debug(`conexão recusada: ${(e as Error).message}`);
      client.disconnect(true);
    }
  }
}

@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  toBranch(tenantId: string, branchId: string, event: string, payload: Record<string, unknown>) {
    this.gateway.server?.to(branchRoom(tenantId, branchId)).emit(event, payload);
  }

  toUser(tenantId: string, userId: string, event: string, payload: Record<string, unknown>) {
    this.gateway.server?.to(`tenant:${tenantId}:user:${userId}`).emit(event, payload);
  }
}
