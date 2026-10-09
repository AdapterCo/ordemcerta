import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  branchSchema,
  createMemberSchema,
  paginationSchema,
  resetMemberPasswordSchema,
  settingSchema,
  supportAccessGrantSchema,
  transferOwnershipSchema,
  updateBranchSchema,
  updateMemberSchema,
  updateTenantSchema,
} from '@ordemcerta/shared';
import { z } from 'zod';
import { Operational, Perm } from '../../core/decorators';
import { Doc, ZBody, ZQuery } from '../../core/zod';
import { MembersService } from './members.service';
import { TenantsService } from './tenants.service';

const settingsPutSchema = z.object({ entries: z.array(settingSchema).min(1).max(30) });
const auditQuerySchema = paginationSchema.extend({ entity: z.string().max(60).optional(), entityId: z.string().max(120).optional() });

@ApiTags('tenant')
@ApiBearerAuth()
@Controller()
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly members: MembersService,
  ) {}

  @Get('tenant')
  @Doc('Dados da empresa')
  getTenant() {
    return this.tenants.getTenant();
  }

  @Patch('tenant')
  @Perm('settings:edit')
  @Operational()
  @Doc('Atualiza dados da empresa', { body: updateTenantSchema })
  updateTenant(@ZBody(updateTenantSchema) body: z.infer<typeof updateTenantSchema>) {
    return this.tenants.updateTenant(body);
  }

  @Post('tenant/onboarding/complete')
  @Perm('settings:edit')
  @Operational()
  @HttpCode(200)
  @Doc('Conclui o onboarding da assistência')
  completeOnboarding() {
    return this.tenants.completeOnboarding();
  }

  @Get('tenant/usage')
  @Doc('Uso das quotas do plano (filiais, técnicos e caixas por filial)')
  usage() {
    return this.tenants.usage();
  }

  @Get('tenant/audit')
  @Perm('audit:view')
  @Doc('Trilha de auditoria da empresa', { query: auditQuerySchema })
  audit(@ZQuery(auditQuerySchema) q: z.infer<typeof auditQuerySchema>) {
    return this.tenants.auditTrail(q);
  }

  @Get('tenant/support-access')
  @Perm('settings:edit')
  @Doc('Acessos de suporte concedidos')
  listSupport() {
    return this.tenants.listSupportAccess();
  }

  @Post('tenant/support-access')
  @Perm('settings:edit')
  @Doc('Autoriza acesso temporário e auditado do suporte (somente proprietário)', { body: supportAccessGrantSchema })
  grantSupport(@ZBody(supportAccessGrantSchema) body: z.infer<typeof supportAccessGrantSchema>) {
    return this.tenants.grantSupportAccess(body);
  }

  @Delete('tenant/support-access/:id')
  @Perm('settings:edit')
  @HttpCode(204)
  @Doc('Revoga acesso de suporte')
  async revokeSupport(@Param('id', ParseUUIDPipe) id: string) {
    await this.tenants.revokeSupportAccess(id);
  }

  @Get('branches')
  @Doc('Filiais autorizadas')
  listBranches(@Query('includeInactive') includeInactive?: string) {
    return this.tenants.listBranches(includeInactive === 'true');
  }

  @Post('branches')
  @Perm('branches:manage')
  @Operational()
  @Doc('Cria filial (respeita limite do plano)', { body: branchSchema })
  createBranch(@ZBody(branchSchema) body: z.infer<typeof branchSchema>) {
    return this.tenants.createBranch(body);
  }

  @Get('branches/:id')
  @Doc('Detalhe da filial')
  getBranch(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.getBranch(id);
  }

  @Patch('branches/:id')
  @Perm('branches:manage')
  @Operational()
  @Doc('Atualiza/ativa/desativa filial', { body: updateBranchSchema })
  updateBranch(@Param('id', ParseUUIDPipe) id: string, @ZBody(updateBranchSchema) body: z.infer<typeof updateBranchSchema>) {
    return this.tenants.updateBranch(id, body);
  }

  @Get('members')
  @Perm('users:manage')
  @Doc('Membros da empresa')
  listMembers() {
    return this.members.list();
  }

  @Get('members/technicians')
  @Perm('os:view')
  @Doc('Técnicos ativos (por filial)')
  technicians(@Query('branchId') branchId?: string) {
    return this.members.technicians(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined);
  }

  @Post('members')
  @Perm('users:manage')
  @Operational()
  @Doc('Cadastra funcionário com senha provisória (troca obrigatória no primeiro login)', { body: createMemberSchema })
  createMember(@ZBody(createMemberSchema) body: z.infer<typeof createMemberSchema>) {
    return this.members.create(body);
  }

  @Post('members/:id/reset-password')
  @Perm('users:manage')
  @HttpCode(200)
  @Doc('Redefine a senha do funcionário (nova senha provisória)', { body: resetMemberPasswordSchema })
  resetMemberPassword(@Param('id', ParseUUIDPipe) id: string, @ZBody(resetMemberPasswordSchema) body: z.infer<typeof resetMemberPasswordSchema>) {
    return this.members.resetPassword(id, body.password);
  }

  @Patch('members/:id')
  @Perm('users:manage')
  @Operational()
  @Doc('Altera papel, status e filiais do membro', { body: updateMemberSchema })
  updateMember(@Param('id', ParseUUIDPipe) id: string, @ZBody(updateMemberSchema) body: z.infer<typeof updateMemberSchema>) {
    return this.members.update(id, body);
  }

  @Post('members/transfer-ownership')
  @Perm('users:manage')
  @HttpCode(200)
  @Doc('Transfere a propriedade da empresa (confirmação por senha)', { body: transferOwnershipSchema })
  transfer(@ZBody(transferOwnershipSchema) body: z.infer<typeof transferOwnershipSchema>) {
    return this.members.transferOwnership(body.membershipId, body.password);
  }

  @Get('settings')
  @Doc('Configurações efetivas da empresa/filial')
  getSettings(@Query('branchId') branchId?: string) {
    return this.tenants.getSettings(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined);
  }

  @Put('settings')
  @Perm('settings:edit')
  @Operational()
  @Doc('Atualiza configurações', { body: settingsPutSchema })
  putSettings(@Body() raw: unknown) {
    return this.tenants.putSettings(settingsPutSchema.parse(raw).entries);
  }
}
