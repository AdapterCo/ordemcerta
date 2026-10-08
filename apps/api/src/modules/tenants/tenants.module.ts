import { Module } from '@nestjs/common';
import { MembersService } from './members.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [TenantsController],
  providers: [TenantsService, MembersService],
  exports: [TenantsService, MembersService],
})
export class TenantsModule {}
