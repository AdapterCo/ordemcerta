import { Module } from '@nestjs/common';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  imports: [ServiceOrdersModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
