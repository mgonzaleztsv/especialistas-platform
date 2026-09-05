import { Module } from '@nestjs/common'; import { SpecialistsController } from './specialists.controller';
import { AdminGuard } from '../auth/admin.guard'; @Module({controllers:[SpecialistsController], providers:[AdminGuard]}) export class SpecialistsModule {}
