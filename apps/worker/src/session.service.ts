import { maskPhone } from '@ordemcerta/shared';
import { BaileysSessionManager, OPT_OUT_KEYWORDS, type BaileysSessionSnapshot } from '@ordemcerta/server';
import type { Deps } from './deps';

const QR_KEY = (channelId: string) => `baileys:qr:${channelId}`;
const QR_TTL_SECONDS = 150;
const STATUS_RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

/**
 * Sessões Baileys (canal não oficial WHATSAPP_UNOFFICIAL_QR) vivem no worker:
 * um socket persistente por canal, sessão criptografada em
 * messaging_channels.encrypted_credentials_ref; QR publicado no Redis para a
 * API ler (TTL curto, renovado a cada emissão). Instanciada diretamente por
 * Deps (sem DI do Nest, evita ciclo de importação).
 */
export class SessionService {
  private readonly log: Deps['log'];
  readonly manager: BaileysSessionManager;

  constructor(private readonly deps: Deps) {
    this.log = deps.log;
    this.manager = new BaileysSessionManager(
      {
        onQr: async (channelId, dataUrl) => {
          if (!dataUrl) await this.deps.redis.del(QR_KEY(channelId));
          else await this.deps.redis.setex(QR_KEY(channelId), QR_TTL_SECONDS, dataUrl);
        },
        onCredentials: async (channelId, snapshot) => this.persistCredentials(channelId, snapshot),
        onConnected: async (channelId, phoneJid) => this.onConnected(channelId, phoneJid),
        onLoggedOut: async (channelId) => this.onLoggedOut(channelId),
        onSessionLost: async (channelId, reason) => {
          this.log.warn({ channelId, reason }, 'baileys: sessão perdida');
          await this.deps.db.messagingChannel.updateMany({ where: { id: channelId, provider: 'WHATSAPP_UNOFFICIAL_QR' }, data: { lastError: reason } });
        },
        onStatus: async (channelId, updates) => this.applyStatusUpdates(channelId, updates),
        onInbound: async (channelId, messages) => this.applyInbound(channelId, messages),
      },
      deps.log,
    );
  }

  async init() {
    await this.manager.init();
    this.bootstrap().catch((e) => this.log.error({ err: (e as Error).message }, 'baileys: falha no bootstrap de sessões'));
  }

  async destroy() {
    await this.manager.destroy();
  }

  /** Restaura sessões existentes (creds armazenados) e retoma QR pendente. */
  async bootstrap() {
    const rows = await this.deps.db.messagingChannel.findMany({
      where: {
        provider: 'WHATSAPP_UNOFFICIAL_QR',
        OR: [{ encryptedCredentialsRef: { not: null } }, { status: 'ONBOARDING' }, { status: 'ACTIVE' }, { status: 'ERROR' }],
      },
      select: { id: true, encryptedCredentialsRef: true },
    });
    for (const row of rows) {
      const snapshot = row.encryptedCredentialsRef ? this.snapshotOf(row.encryptedCredentialsRef) : undefined;
      this.manager.connect(row.id, snapshot);
      await new Promise((r) => setTimeout(r, 250));
    }
    if (rows.length) this.log.info({ count: rows.length }, 'baileys: sessões restauradas');
  }

  private snapshotOf(encrypted: string): BaileysSessionSnapshot | undefined {
    try {
      return JSON.parse(this.deps.crypto.decrypt(encrypted)) as BaileysSessionSnapshot;
    } catch {
      this.log.error('baileys: sessão armazenada não descriptografável (chave rotacionada?)');
      return undefined;
    }
  }

  private async persistCredentials(channelId: string, snapshot: BaileysSessionSnapshot) {
    await this.deps.db.messagingChannel.updateMany({
      where: { id: channelId, provider: 'WHATSAPP_UNOFFICIAL_QR' },
      data: { encryptedCredentialsRef: this.deps.crypto.encrypt(JSON.stringify(snapshot)) },
    });
  }

  private async onConnected(channelId: string, phoneJid: string | null) {
    this.log.info({ channelId, phone: phoneJid ? maskPhone(`+${phoneJid}`) : null }, 'baileys: conectado');
    await this.deps.db.messagingChannel.updateMany({
      where: { id: channelId, provider: 'WHATSAPP_UNOFFICIAL_QR' },
      data: {
        status: 'ACTIVE',
        externalPhoneId: phoneJid,
        displayPhoneMasked: phoneJid ? maskPhone(`+${phoneJid}`) : undefined,
        connectedAt: new Date(),
        disconnectedAt: null,
        lastError: null,
        version: { increment: 1 },
      },
    });
  }

  /** Deslogado pelo WhatsApp (usuário removeu o dispositivo vinculado). */
  private async onLoggedOut(channelId: string) {
    this.log.warn({ channelId }, 'baileys: sessão deslogada pelo WhatsApp');
    const channel = await this.deps.db.messagingChannel.findUnique({ where: { id: channelId }, select: { tenantId: true } });
    if (!channel) return;
    await this.deps.db.messagingChannel.updateMany({
      where: { id: channelId, provider: 'WHATSAPP_UNOFFICIAL_QR' },
      data: {
        status: 'DISCONNECTED',
        encryptedCredentialsRef: null,
        disconnectedAt: new Date(),
        lastError: 'Sessão deslogada no WhatsApp — gere um novo QR para reconectar',
      },
    });
    await this.deps.db.messageDelivery.updateMany({
      where: { tenantId: channel.tenantId, channelId, status: 'QUEUED' },
      data: { status: 'BLOCKED', lastError: 'Sessão WhatsApp deslogada' },
    });
    await this.deps.db.auditLog.create({
      data: { tenantId: channel.tenantId, actorType: 'SYSTEM', action: 'whatsapp_session_logged_out', entity: 'messaging_channel', entityId: channelId },
    });
  }

  /** Status de entrega (DES 2=deliver, 3/4=lida) via socket, com monotonicidade. */
  private async applyStatusUpdates(channelId: string, updates: Array<{ providerMessageId: string; waStatus: number }>) {
    const now = new Date();
    for (const u of updates) {
      const next = u.waStatus >= 3 ? 'READ' : u.waStatus === 2 ? 'DELIVERED' : null;
      if (!next) continue;
      const d = await this.deps.db.messageDelivery.findFirst({ where: { providerMessageId: u.providerMessageId, channelId } });
      if (!d || (STATUS_RANK[next] ?? 0) <= (STATUS_RANK[d.status] ?? 0)) continue;
      await this.deps.db.messageDelivery.update({
        where: { id: d.id },
        data: {
          status: next,
          deliveredAt: next === 'DELIVERED' ? now : d.deliveredAt,
          readAt: next === 'READ' ? now : d.readAt,
        },
      });
      const channel = await this.deps.db.messagingChannel.findUnique({ where: { id: channelId }, select: { firstDeliveredAt: true } });
      if (channel && !channel.firstDeliveredAt) {
        await this.deps.db.messagingChannel.update({ where: { id: channelId }, data: { firstDeliveredAt: now } });
      }
    }
  }

  /** Opt-out por palavra-chave nas mensagens recebidas (mesma regra do webhook oficial). */
  private async applyInbound(channelId: string, messages: Array<{ fromE164: string; text: string }>) {
    for (const m of messages) {
      if (!OPT_OUT_KEYWORDS.includes(m.text.trim().toUpperCase())) continue;
      const channel = await this.deps.db.messagingChannel.findUnique({ where: { id: channelId }, select: { tenantId: true } });
      if (!channel) continue;
      const customers = await this.deps.db.customer.findMany({
        where: { tenantId: channel.tenantId, OR: [{ whatsappE164: m.fromE164 }, { phoneE164: m.fromE164 }] },
        select: { id: true },
      });
      const now = new Date();
      for (const c of customers) {
        await this.deps.db.customerConsent.updateMany({
          where: { tenantId: channel.tenantId, customerId: c.id, channel: 'WHATSAPP', revokedAt: null },
          data: { revokedAt: now },
        });
        await this.deps.db.auditLog.create({
          data: { tenantId: channel.tenantId, actorType: 'CUSTOMER', action: 'whatsapp_opt_out', entity: 'customer', entityId: c.id },
        });
        this.log.info({ channelId, customerId: c.id }, 'baileys: opt-out registrado');
      }
    }
  }

  /** Início/reinício de sessão (job session-start da fila messaging). */
  async startSession(channelId: string) {
    const channel = await this.deps.db.messagingChannel.findFirst({ where: { id: channelId, provider: 'WHATSAPP_UNOFFICIAL_QR' } });
    if (!channel) {
      this.log.warn({ channelId }, 'baileys: canal inexistente para session-start');
      return;
    }
    if (channel.encryptedCredentialsRef) {
      const snapshot = this.snapshotOf(channel.encryptedCredentialsRef);
      this.manager.connect(channel.id, snapshot ?? undefined);
    } else {
      // QR novo: sessão sem credenciais salva (ou após deslog)
      this.manager.connect(channel.id, undefined);
    }
  }

  /** Encerra a sessão (job session-stop); logout remove o vínculo no WhatsApp. */
  async stopSession(channelId: string, logout = false) {
    await this.manager.stopSession(channelId, { logout });
  }

  /** Garante sessão online antes de um envio (usado pelo MessagingProcessor). */
  async ensureForSend(channelId: string, encryptedCredentialsRef: string) {
    await this.manager.ensureOnline(channelId, () => this.snapshotOf(encryptedCredentialsRef));
  }

  async sendText(channelId: string, toE164: string, text: string) {
    return this.manager.sendText(channelId, toE164, text);
  }
}
