import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ClientsModule } from './clients/clients.module';
import { SpecialistsModule } from './specialists/specialists.module';
import { CategoriesModule } from './categories/categories.module';
import { JobRequestsModule } from './job-requests/job-requests.module';

@Module({ imports: [ScheduleModule.forRoot(), PrismaModule, AuthModule, UsersModule, ClientsModule, SpecialistsModule, CategoriesModule, JobRequestsModule] })
export class AppModule {}
