import { Module } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JobRequestsController } from './job-requests.controller';

@Module({
  controllers: [JobRequestsController],
  providers: [AdminGuard]
})
export class JobRequestsModule {}
