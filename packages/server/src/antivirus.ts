import { Socket } from 'node:net';

export type ScanResult = { status: 'CLEAN' } | { status: 'INFECTED'; signature: string };

/**
 * Cliente clamd (protocolo INSTREAM). Sem CLAMAV_HOST, a varredura não é
 * executada e o arquivo fica NOT_SCANNED (exibido como "não verificado").
 */
export class ClamAvScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 30_000,
  ) {}

  scan(buffer: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      let response = '';
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Timeout na varredura antivírus'));
      }, this.timeoutMs);

      socket.connect(this.port, this.host, () => {
        socket.write('zINSTREAM\0');
        const chunkSize = 64 * 1024;
        for (let i = 0; i < buffer.length; i += chunkSize) {
          const chunk = buffer.subarray(i, i + chunkSize);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length, 0);
          socket.write(size);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on('data', (d) => (response += d.toString()));
      socket.on('end', () => {
        clearTimeout(timer);
        const r = response.replace(/\0/g, '').trim();
        if (r.endsWith('OK')) return resolve({ status: 'CLEAN' });
        const m = /stream: (.+) FOUND/.exec(r);
        if (m) return resolve({ status: 'INFECTED', signature: m[1]! });
        reject(new Error(`Resposta clamd inesperada: ${r.slice(0, 120)}`));
      });
      socket.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }
}
