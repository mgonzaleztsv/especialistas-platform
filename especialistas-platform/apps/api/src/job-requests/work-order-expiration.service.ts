import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WorkOrderExpirationService {
  private readonly logger = new Logger(
    WorkOrderExpirationService.name
  );

  constructor(
    private readonly prisma: PrismaService
  ) {}

  async findExpiredWorkOrders() {
    const now = new Date();

    return this.prisma.workOrder.findMany({
      where: {
        status: 'PENDING_ACCEPTANCE',
        responseDeadline: {
          lte: now
        },
        jobRequest: {
          status: 'PENDING_AGREEMENT'
        },
        proposal: {
          status: 'SELECTED'
        }
      },
      orderBy: {
        responseDeadline: 'asc'
      },
      select: {
        id: true,
        jobRequestId: true,
        proposalId: true,
        negotiationId: true,
        version: true,
        responseDeadline: true,
        extensionApprovedAt: true
      }
    });
  }


  private async closeExpiredWorkOrder(
    workOrderId: string
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const now = new Date();

          const order = await tx.workOrder.findUnique({
            where: { id: workOrderId }
          });

          if (
            !order ||
            order.status !== 'PENDING_ACCEPTANCE' ||
            !order.responseDeadline ||
            order.responseDeadline > now
          ) {
            return false;
          }

          const latest = await tx.workOrder.findFirst({
            where: { jobRequestId: order.jobRequestId },
            orderBy: { version: 'desc' },
            select: { id: true }
          });

          if (latest?.id !== order.id) {
            return false;
          }

          const job = await tx.jobRequest.findUnique({
            where: { id: order.jobRequestId }
          });

          const proposal = await tx.proposal.findUnique({
            where: { id: order.proposalId }
          });

          if (
            job?.status !== 'PENDING_AGREEMENT' ||
            proposal?.status !== 'SELECTED'
          ) {
            return false;
          }

          const closed = await tx.workOrder.updateMany({
            where: {
              id: order.id,
              status: 'PENDING_ACCEPTANCE',
              responseDeadline: { lte: now }
            },
            data: {
              status: 'CANCELLED',
              closedAt: now,
              closureReason: 'RESPONSE_DEADLINE_EXPIRED'
            }
          });

          if (closed.count !== 1) {
            throw new Error('La orden cambió durante el cierre');
          }

          const released = await tx.proposal.updateMany({
            where: {
              id: order.proposalId,
              status: 'SELECTED'
            },
            data: { status: 'PENDING' }
          });

          if (released.count !== 1) {
            throw new Error('La propuesta cambió durante el cierre');
          }

          const reopened = await tx.jobRequest.updateMany({
            where: {
              id: order.jobRequestId,
              status: 'PENDING_AGREEMENT'
            },
            data: { status: 'RECEIVING_QUOTES' }
          });

          if (reopened.count !== 1) {
            throw new Error('La solicitud cambió durante el cierre');
          }

          return true;
        }, {
          isolationLevel: 'Serializable'
        });

      } catch (error) {
        const conflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034';

        if (!conflict || attempt === 3) {
          throw error;
        }
      }
    }

    return false;
  }

  @Cron('0 */5 * * * *')
  async reportExpiredWorkOrders() {
    const expired = await this.findExpiredWorkOrders();

    if (process.env.WORK_ORDER_EXPIRATION_ENABLED !== 'true') {
      this.logger.log(
        `Cierre automático desactivado. Órdenes vencidas: ${expired.length}`
      );
      return expired;
    }

    let closed = 0;
    let failed = 0;

    for (const order of expired) {
      try {
        const result = await this.closeExpiredWorkOrder(order.id);
        if (result) closed++;
      } catch (error) {
        failed++;
        this.logger.error(
          `No se pudo cerrar la Orden de Trabajo ${order.id}`,
          error instanceof Error ? error.stack : String(error)
        );
      }
    }

    this.logger.log(
      `Vencimientos: ${expired.length}; cerradas: ${closed}; errores: ${failed}`
    );

    return expired;
  }
}
