import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { LocalStorage, sniffMime } from '@ordemcerta/server';
import type { Response } from 'express';
import { Public } from './decorators';
import { Errors } from './errors';
import { StorageService } from './services';

/** Download de URLs assinadas do armazenamento LOCAL (somente desenvolvimento). */
@ApiExcludeController()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get('local/:token')
  async local(@Param('token') token: string, @Res() res: Response) {
    const provider = this.storage.provider;
    if (!(provider instanceof LocalStorage)) throw Errors.notFound('Arquivo');
    const key = provider.verify(token);
    if (!key) throw Errors.tokenInvalid();
    const buf = await provider.get(key);
    res.setHeader('Content-Type', sniffMime(buf) ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  }
}
