import { Module } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JobRequestsController } from './job-requests.controller';
import { WorkOrderExpirationService } from './work-order-expiration.service';

@Module({
  controllers: [JobRequestsController],
  providers: [AdminGuard, WorkOrderExpirationService]
})
export class JobRequestsModule {}
