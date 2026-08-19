import { Module } from '@nestjs/common';
import { JobRequestsController } from './job-requests.controller';

@Module({
  controllers: [JobRequestsController]
})
export class JobRequestsModule {}
