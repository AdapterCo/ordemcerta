import {
  makeWASocket,
  Browsers,
  BufferJSON,
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  proto,
  type AuthenticationState,
  type ConnectionState,
  type SignalDataSet,
  type SignalDataTypeMap,
  type WAVersion,
  type WASocket,
} from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { MessagingError } from './whatsapp';

/**
 * Canal NÃO OFICIAL via Baileys (protocolo WhatsApp Web multi-device).
 * Cada canal = um "dispositivo vinculado" no WhatsApp do tenant.
 * Sessão persistida criptografada pelo chamador (EncryptionService); status de
 * entrega e mensagens recebidas chegam pelo próprio socket (não há webhook).
 * AVISO: integração não oficial — sujeita a desconexão/restrição pela Meta.
 */

/** Sessão serializada (BufferJSON) para persistência. */
export interface BaileysSessionSnapshot {
  creds: string;
  keys: Record<string, string>;
}

export interface BaileysStatusUpdate {
  /** id da mensagem enviada (equivalente ao providerMessageId da Cloud API). */
  providerMessageId: string;
  /** 2=entregue, 3=lida, 4=tocada (PLAYED). */
  waStatus: number;
}

export interface BaileysInboundMessage {
  fromE164: string;
  text: string;
}

export interface BaileysEvents {
  /** QR novo como data URL PNG; string vazia = limpar (conectou/deslogou). */
  onQr(channelId: string, qrDataUrl: string): void;
  /** Sessão pareada (jid normalizado sem device: dígitos apenas). */
  onConnected(channelId: string, phoneJid: string | null): void;
  /** Sessão alterada — persistir criptografado. */
  onCredentials(channelId: string, snapshot: BaileysSessionSnapshot): void;
  /** Deslogado pelo WhatsApp; credenciais não servem mais. */
  onLoggedOut(channelId: string): void;
  /** Reconexões automáticas falhando repetidamente (sessão segue tentando). */
  onSessionLost(channelId: string, reason: string): void;
  /** QR expirou sem ninguém ler (sessão encerrada; o usuário gera outro quando quiser). */
  onQrExpired(channelId: string): void;
  /** Updates de status das mensagens enviadas. */
  onStatus(channelId: string, updates: BaileysStatusUpdate[]): void;
  /** Mensagens recebidas de clientes (para opt-out por palavra-chave). */
  onInbound(channelId: string, messages: BaileysInboundMessage[]): void;
}

export interface BaileysLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

interface OwnAuthState {
  state: AuthenticationState;
  snapshot(): BaileysSessionSnapshot;
}

const SAVE_DEBOUNCE_MS = 1_000;
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_CAP_MS = 60_000;
const SESSION_LOST_AFTER = 8;

export class BaileysSessionManager {
  private version: WAVersion | undefined;
  private readonly sockets = new Map<string, WASocket>();
  private readonly auths = new Map<string, OwnAuthState>();
  private readonly saveTimers = new Map<string, NodeJS.Timeout>();
  private readonly attempts = new Map<string, number>();
  private readonly lostNotified = new Set<string>();
  private readonly connecting = new Map<string, Promise<void>>();
  private stopped = false;

  constructor(
    private readonly events: BaileysEvents,
    private readonly log: BaileysLogger,
  ) {}

  /** Busca a versão do protocolo WA Web (fallback: versão fixada do pacote). */
  async init() {
    try {
      const res = await fetchLatestBaileysVersion();
      this.version = res.version;
      this.log.info({ version: this.version.join('.') }, 'baileys: pronto');
    } catch {
      this.log.warn('baileys: sem rede para fetchLatestBaileysVersion; usando versão do pacote');
    }
  }

  /** Constrói auth state próprio com shadow-store em memória + snapshot serializável. */
  private static buildAuthState(initial?: BaileysSessionSnapshot): OwnAuthState {
    const creds = initial?.creds ? (JSON.parse(initial.creds, BufferJSON.reviver) as ReturnType<typeof initAuthCreds>) : initAuthCreds();
    const shadow = new Map<string, string>();
    if (initial?.keys) for (const [k, v] of Object.entries(initial.keys)) shadow.set(k, v);
    const keys: NonNullable<AuthenticationState['keys']> = {
      get: async (type, ids) => {
        const out: { [id: string]: SignalDataTypeMap[typeof type] } = {};
        for (const id of ids) {
          const raw = shadow.get(`${String(type)}^${id}`);
          if (raw === undefined) continue;
          let value = JSON.parse(raw, BufferJSON.reviver);
          // como no useMultiFileAuthState oficial: chave de sincronização volta a ser objeto protobuf
          if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
          out[id] = value as SignalDataTypeMap[typeof type];
        }
        return out;
      },
      set: async (data: SignalDataSet) => {
        for (const [type, entries] of Object.entries(data) as Array<[keyof SignalDataTypeMap, Record<string, unknown> | undefined]>) {
          if (!entries) continue;
          for (const [id, value] of Object.entries(entries)) {
            const key = `${String(type)}^${id}`;
            if (value === null || value === undefined) shadow.delete(key);
            else shadow.set(key, JSON.stringify(value, BufferJSON.replacer));
          }
        }
      },
    };
    return {
      state: { creds, keys },
      snapshot: () => ({
        creds: JSON.stringify(creds, BufferJSON.replacer),
        keys: Object.fromEntries(shadow),
      }),
    };
  }

  private persist(channelId: string) {
    const auth = this.auths.get(channelId);
    if (!auth) return;
    try {
      this.events.onCredentials(channelId, auth.snapshot());
    } catch (e) {
      this.log.error({ channelId, err: (e as Error).message }, 'baileys: falha ao persistir sessão');
    }
  }

  private scheduleSave(channelId: string) {
    if (this.saveTimers.has(channelId)) return;
    this.saveTimers.set(
      channelId,
      setTimeout(() => {
        this.saveTimers.delete(channelId);
        this.persist(channelId);
      }, SAVE_DEBOUNCE_MS),
    );
  }

  /** Conecta (ou reconecta) a sessão do canal. QR é emitido via events. */
  connect(channelId: string, snapshot?: BaileysSessionSnapshot): void {
    if (this.stopped || this.sockets.has(channelId)) return;
    const auth = BaileysSessionManager.buildAuthState(snapshot);
    this.auths.set(channelId, auth);
    const sock = makeWASocket({
      version: this.version,
      auth: auth.state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.macOS('OrdemCerta'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 20_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 30_000,
    });
    this.sockets.set(channelId, sock);

    sock.ev.on('creds.update', () => {
      if (this.sockets.get(channelId) === sock) this.scheduleSave(channelId);
    });
    sock.ev.on('connection.update', (u) => void this.handleConnectionChange(channelId, sock, u));
    sock.ev.on('messages.upsert', (up) => {
      if (up.type !== 'notify') return;
      const msgs: BaileysInboundMessage[] = [];
      for (const m of up.messages) {
        if (m.key.fromMe) continue;
        const jid = m.key.remoteJid ?? '';
        if (!jid.endsWith('@s.whatsapp.net')) continue;
        const text = String(m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? '').trim();
        if (text) msgs.push({ fromE164: `+${jid.split('@')[0].replace(/\D/g, '')}`, text });
      }
      if (msgs.length) this.events.onInbound(channelId, msgs);
    });
    sock.ev.on('messages.update', (updates) => {
      const list: BaileysStatusUpdate[] = [];
      for (const { key, update } of updates) {
        if (key.fromMe !== true || typeof update.status !== 'number' || !key.id) continue;
        if (key.remoteJid?.includes('@g.us') || key.remoteJid === 'status@broadcast') continue;
        list.push({ providerMessageId: key.id, waStatus: update.status });
      }
      if (list.length) this.events.onStatus(channelId, list);
    });
  }

  private async handleConnectionChange(channelId: string, sock: WASocket, u: Partial<ConnectionState>) {
    // Socket antigo (sessão parada/reiniciada): ignora, senão o "close" dele agendaria
    // uma reconexão fantasma e o QR seria gerado sem fim.
    if (this.stopped || this.sockets.get(channelId) !== sock) return;
    if (u.qr) {
      try {
        this.events.onQr(channelId, await QRCode.toDataURL(u.qr, { margin: 1, width: 320 }));
      } catch (e) {
        this.log.error({ channelId, err: (e as Error).message }, 'baileys: falha ao renderizar QR');
      }
      return;
    }
    if (u.connection === 'open') {
      this.attempts.set(channelId, 0);
      this.lostNotified.delete(channelId);
      this.events.onQr(channelId, '');
      this.events.onConnected(channelId, this.selfJid(channelId));
      // pre-keys/registro terminam pouco após o open: persiste definitiva
      setTimeout(() => this.persist(channelId), 3_000);
      return;
    }
    if (u.connection === 'close') {
      const err = u.lastDisconnect?.error as unknown as { output?: { statusCode?: number }; message?: string } | undefined;
      const code = err?.output?.statusCode;
      const reason = err?.message?.slice(0, 200);
      if (code === DisconnectReason.loggedOut) {
        await this.stopSession(channelId);
        this.events.onLoggedOut(channelId);
        return;
      }
      const paired = Boolean(this.auths.get(channelId)?.state.creds.me);
      if (code === DisconnectReason.timedOut && !paired) {
        // "QR refs attempts ended": ninguém leu o QR — para de gerar QR até o usuário pedir outro
        await this.stopSession(channelId);
        this.events.onQrExpired(channelId);
        return;
      }
      if (code === DisconnectReason.restartRequired) {
        // Fluxo normal logo após ler o QR: o WhatsApp pede para reabrir a conexão já pareada.
        const snapshot = this.auths.get(channelId)?.snapshot();
        this.sockets.delete(channelId);
        if (snapshot) this.events.onCredentials(channelId, snapshot);
        setTimeout(() => {
          if (!this.stopped) this.connect(channelId, snapshot);
        }, 500);
        return;
      }
      const attempts = (this.attempts.get(channelId) ?? 0) + 1;
      this.attempts.set(channelId, attempts);
      if (attempts >= SESSION_LOST_AFTER && !this.lostNotified.has(channelId)) {
        this.lostNotified.add(channelId);
        this.events.onSessionLost(channelId, 'Reconexão automática falhando — verifique internet/firewall do servidor');
      }
      const snapshot = this.auths.get(channelId)?.snapshot();
      this.sockets.delete(channelId); // socket morto: libera a vaga para o reconnect
      const delay = Math.min(RECONNECT_BASE_MS * attempts, RECONNECT_CAP_MS);
      this.log.warn({ channelId, code, reason, paired: Boolean(this.auths.get(channelId)?.state.creds.me), attempts, delay }, 'baileys: conexão fechada; agendando reconexão');
      setTimeout(() => {
        if (!this.stopped) this.connect(channelId, snapshot);
      }, delay);
    }
  }

  private selfJid(channelId: string): string | null {
    const me = this.sockets.get(channelId)?.user?.id;
    if (!me) return null;
    return me.split('@')[0].split(':')[0] || null;
  }

  readSnapshot(channelId: string): BaileysSessionSnapshot | undefined {
    return this.auths.get(channelId)?.snapshot();
  }

  isOnline(channelId: string): boolean {
    return this.sockets.get(channelId)?.user != null;
  }

  /** Garante sessão online; reconecta com credenciais do loader com timeout. */
  async ensureOnline(channelId: string, load: () => BaileysSessionSnapshot | undefined, timeoutMs = 25_000): Promise<void> {
    if (this.isOnline(channelId)) return;
    const pending = this.connecting.get(channelId);
    if (pending) {
      await pending;
    } else {
      const task = (async () => {
        if (!this.isOnline(channelId)) {
          const snapshot = load();
          if (!snapshot) throw new MessagingError('Sem sessão WhatsApp armazenada — gere um novo QR', 'PROVIDER_ERROR', false);
        }
        this.connect(channelId, load());
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline && !this.isOnline(channelId)) {
          await new Promise((r) => setTimeout(r, 500));
          if (!this.sockets.has(channelId)) break; // deslogado
        }
      })();
      this.connecting.set(channelId, task);
      try {
        await task;
      } finally {
        this.connecting.delete(channelId);
      }
    }
    if (!this.isOnline(channelId)) throw new MessagingError('Sessão WhatsApp não conectou a tempo', 'PROVIDER_ERROR', true);
  }

  /** Envia texto (mensagem já renderizada). Exige sessão online. */
  async sendText(channelId: string, toE164: string, text: string): Promise<{ providerMessageId: string }> {
    const sock = this.sockets.get(channelId);
    if (!sock?.user) throw new MessagingError('Sessão WhatsApp não conectada', 'PROVIDER_ERROR', true);
    const jid = `${toE164.replace(/\D/g, '')}@s.whatsapp.net`;
    try {
      const sent = await sock.sendMessage(jid, { text: text.slice(0, 4096) });
      const id = sent?.key?.id;
      if (!id) throw new MessagingError('Envio sem identificador de mensagem', 'PROVIDER_ERROR', true);
      return { providerMessageId: id };
    } catch (e) {
      if (e instanceof MessagingError) throw e;
      throw new MessagingError((e as Error).message, 'PROVIDER_ERROR', true);
    }
  }

  /** Encerra a sessão local; logout=true remove o vínculo também no WhatsApp do tenant. */
  async stopSession(channelId: string, opts: { logout?: boolean } = {}): Promise<void> {
    const sock = this.sockets.get(channelId);
    this.sockets.delete(channelId);
    this.auths.delete(channelId);
    const timer = this.saveTimers.get(channelId);
    if (timer) clearTimeout(timer);
    this.saveTimers.delete(channelId);
    this.events.onQr(channelId, '');
    if (sock) {
      try {
        if (opts.logout) await sock.logout('Sessão removida pela OrdemCerta');
        else sock.end(new Error('OrdemCerta: stopSession'));
      } catch (e) {
        this.log.warn({ channelId, err: (e as Error).message }, 'baileys: falha ao encerrar sessão');
      }
    }
  }

  async destroy() {
    this.stopped = true;
    for (const channelId of Array.from(this.sockets.keys())) await this.stopSession(channelId);
  }
}
