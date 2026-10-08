import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { consentSchema, customerQuerySchema, customerSchema, deviceSchema, updateCustomerSchema } from '@ordemcerta/shared';
import { z } from 'zod';
import { Operational, Perm } from '../../core/decorators';
import { Doc, ZBody, ZQuery } from '../../core/zod';
import { CustomersService } from './customers.service';

const revealSchema = z.object({ reason: z.string().trim().min(5).max(300) });

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Perm('customer:view')
  @Doc('Busca clientes por nome, telefone, documento ou e-mail', { query: customerQuerySchema })
  list(@ZQuery(customerQuerySchema) q: z.infer<typeof customerQuerySchema>) {
    return this.customers.list(q);
  }

  @Post()
  @Perm('customer:edit')
  @Operational()
  @Doc('Cadastra cliente (deduplicação por telefone/documento dentro da empresa)', { body: customerSchema })
  create(@ZBody(customerSchema) body: z.infer<typeof customerSchema>, @Query('allowDuplicate') allowDuplicate?: string) {
    return this.customers.create(body, allowDuplicate === 'true');
  }

  @Get(':id')
  @Perm('customer:view')
  @Doc('Detalhe do cliente com aparelhos, consentimentos e histórico de OS')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(id);
  }

  @Patch(':id')
  @Perm('customer:edit')
  @Operational()
  @Doc('Atualiza cliente', { body: updateCustomerSchema })
  update(@Param('id', ParseUUIDPipe) id: string, @ZBody(updateCustomerSchema) body: z.infer<typeof updateCustomerSchema>) {
    return this.customers.update(id, body);
  }

  @Post(':id/consents')
  @Perm('customer:edit')
  @HttpCode(200)
  @Doc('Registra/revoga consentimento por canal e finalidade', { body: consentSchema })
  consent(@Param('id', ParseUUIDPipe) id: string, @ZBody(consentSchema) body: z.infer<typeof consentSchema>) {
    return this.customers.setConsent(id, body);
  }

  @Get(':id/devices')
  @Perm('customer:view')
  @Doc('Aparelhos do cliente (identificadores mascarados)')
  devices(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.listDevices(id);
  }

  @Post(':id/devices')
  @Perm('customer:edit')
  @Operational()
  @Doc('Cadastra aparelho (IMEI/serial criptografados)', { body: deviceSchema })
  createDevice(@Param('id', ParseUUIDPipe) id: string, @ZBody(deviceSchema) body: z.infer<typeof deviceSchema>) {
    return this.customers.createDevice(id, body);
  }

  @Post('devices/:deviceId/reveal')
  @Perm('os:unlock_secret')
  @HttpCode(200)
  @Doc('Exibe IMEI/serial completo com justificativa (auditado)', { body: revealSchema })
  reveal(@Param('deviceId', ParseUUIDPipe) deviceId: string, @ZBody(revealSchema) body: z.infer<typeof revealSchema>) {
    return this.customers.revealDevice(deviceId, body.reason);
  }

  @Get(':id/export')
  @Perm('customer:export')
  @Doc('Exportação dos dados do titular (LGPD)')
  export(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.exportData(id);
  }

  @Post(':id/anonymize')
  @Perm('customer:anonymize')
  @HttpCode(200)
  @Doc('Anonimiza cliente preservando registros legais')
  anonymize(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.anonymize(id);
  }
}
