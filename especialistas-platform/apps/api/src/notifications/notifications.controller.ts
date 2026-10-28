import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
  UseGuards
} from '@nestjs/common';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private prisma: PrismaService) {}

  @Patch(':id/read')
  async markAsRead(
    @Req() req: any,
    @Param('id') id: string
  ) {
    const where = {
      id,
      userId: req.user.userId
    };

    const notification = await this.prisma.notification.findFirst({
      where
    });

    if (!notification) {
      throw new NotFoundException(
        'Notificación no encontrada'
      );
    }

    if (notification.readAt !== null) {
      return notification;
    }

    await this.prisma.notification.updateMany({
      where: {
        ...where,
        readAt: null
      },
      data: {
        readAt: new Date()
      }
    });

    const updated = await this.prisma.notification.findFirst({
      where
    });

    if (!updated) {
      throw new NotFoundException(
        'Notificación no encontrada'
      );
    }

    return updated;
  }

  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    const count = await this.prisma.notification.count({
      where: {
        userId: req.user.userId,
        readAt: null
      }
    });

    return { count };
  }

  @Get()
  async list(@Req() req: any) {
    return this.prisma.notification.findMany({
      where: {
        userId: req.user.userId
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 50,
      select: {
        id: true,
        jobRequestId: true,
        type: true,
        title: true,
        body: true,
        readAt: true,
        createdAt: true
      }
    });
  }
}
