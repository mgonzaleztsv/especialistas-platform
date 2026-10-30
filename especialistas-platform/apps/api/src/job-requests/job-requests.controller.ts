import { containsLikelyStreetAddress } from './public-text-privacy';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { evaluateCoverage } from '../common/geo-coverage';
import { registerNewJobNotificationEvent } from '../notifications/notification-outbox';

@Controller('job-requests')
@UseGuards(JwtAuthGuard)
export class JobRequestsController {
  constructor(private prisma: PrismaService) {}
  private isTransactionConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    );
  }

  private async retryTransaction<T>(
  operation: () => Promise<T>
): Promise<T> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!this.isTransactionConflict(error)) {
        throw error;
      }

      if (attempt === maxAttempts) {
        throw new ConflictException(
          'La operación entró en conflicto con otro cambio. Actualiza e intenta nuevamente.'
        );
      }
    }
  }

  throw new Error(
    'No fue posible completar la operación'
  );
}

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    if (
      containsLikelyStreetAddress(body?.title) ||
      containsLikelyStreetAddress(body?.description)
    ) {
      throw new BadRequestException(
        'Por privacidad, no incluyas una dirección exacta en el título o la descripción. La dirección del servicio se proporcionará por separado.'
      );
    }
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      throw new Error('El usuario no tiene perfil de cliente');
    }

    const latitude = body?.latitude;
    const longitude = body?.longitude;

    const hasLatitude = latitude !== undefined && latitude !== null;
    const hasLongitude = longitude !== undefined && longitude !== null;

    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException(
        'Debes proporcionar latitud y longitud juntas'
      );
    }

    if (hasLatitude) {
      if (
        typeof latitude !== 'number' ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        typeof longitude !== 'number' ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        throw new BadRequestException(
          'Las coordenadas del trabajo no son válidas'
        );
      }
    }

    const city =
      typeof body?.city === 'string'
        ? body.city.trim()
        : '';

    const state =
      typeof body?.state === 'string'
        ? body.state.trim()
        : '';

    const zipcode =
      typeof body?.zipcode === 'string'
        ? body.zipcode.trim()
        : '';

    if (!city || !state) {
      throw new BadRequestException(
        'Ciudad y estado son obligatorios'
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobRequest.create({
      data: {
        clientId: client.id,
        categoryId: body.categoryId,
        title: body.title,
        description: body.description,
        budgetMin: null,
        budgetMax: null,
        city,
        state,
        zipcode: zipcode || null,
        latitude: hasLatitude ? latitude : null,
        longitude: hasLongitude ? longitude : null,
        desiredDate: body.desiredDate
          ? new Date(body.desiredDate)
          : null
      },
      include: {
        category: true
      }
      });

      if (
        hasLatitude &&
        hasLongitude &&
        job.locationVerificationStatus === 'VERIFIED'
      ) {
        await registerNewJobNotificationEvent(tx, job.id);
      }

      const {
        latitude: privateLatitude,
        longitude: privateLongitude,
        locationVerifiedAt: privateVerificationDate,
        ...clientJob
      } = job;

      return clientJob;
    });
  }

  @Post(':id/proposals')
  async createProposal(
    @Req() req: any,
    @Param('id') jobRequestId: string,
    @Body() body: any
  ) {
    if (
      containsLikelyStreetAddress(body?.includedScope) ||
      containsLikelyStreetAddress(body?.excludedScope) ||
      containsLikelyStreetAddress(body?.message)
    ) {
      throw new BadRequestException(
        'Por privacidad, no incluyas una dirección exacta en los textos de la propuesta o de la Orden de Trabajo.'
      );
    }

    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      throw new Error('El usuario no tiene perfil de especialista');
    }

    const jobRequest = await this.prisma.jobRequest.findUnique({
      where: { id: jobRequestId }
    });

    if (!jobRequest) {
      throw new Error('La solicitud de trabajo no existe');
    }

    if (
      !['PUBLISHED', 'RECEIVING_QUOTES'].includes(jobRequest.status)
    ) {
      throw new Error('Esta solicitud ya no acepta propuestas');
    }

    const amount = Number(body.amount);
    const materialsAmount =
      body.materialsAmount !== undefined && body.materialsAmount !== null
        ? Number(body.materialsAmount)
        : 0;

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('El precio de mano de obra debe ser mayor que cero');
    }

    if (!Number.isFinite(materialsAmount) || materialsAmount < 0) {
      throw new Error('El importe de materiales no es válido');
    }

    return this.prisma.$transaction(async (tx) => {
      const proposal = await tx.proposal.create({
        data: {
          jobRequestId,
          specialistId: specialist.id,
          amount,
          materialsAmount,
          includedScope: body.includedScope?.trim() || null,
          excludedScope: body.excludedScope?.trim() || null,
          message: body.message?.trim() || null,
          availableDate: body.availableDate
            ? new Date(body.availableDate)
            : null
        }
      });

      await tx.jobRequest.updateMany({
        where: {
          id: jobRequestId,
          status: 'PUBLISHED'
        },
        data: {
          status: 'RECEIVING_QUOTES'
        }
      });

      return proposal;
    });
  }

  @Patch(':jobId/proposals/:proposalId')
  async updateProposal(
    @Req() req: any,
    @Param('jobId') jobRequestId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: any
  ) {
    if (
      containsLikelyStreetAddress(body?.includedScope) ||
      containsLikelyStreetAddress(body?.excludedScope) ||
      containsLikelyStreetAddress(body?.message)
    ) {
      throw new BadRequestException(
        'Por privacidad, no incluyas una dirección exacta en los textos de la propuesta o de la Orden de Trabajo.'
      );
    }

    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      throw new Error('El usuario no tiene perfil de especialista');
    }

    const proposal = await this.prisma.proposal.findFirst({
      where: {
        id: proposalId,
        jobRequestId,
        specialistId: specialist.id,
        status: {
          in: ['PENDING', 'WITHDRAWN']
        },
        jobRequest: {
          status: {
            in: ['PUBLISHED', 'RECEIVING_QUOTES']
          }
        }
      }
    });

    if (!proposal) {
      throw new Error(
        'La propuesta no existe, no te pertenece o ya no puede editarse'
      );
    }

    const data: any = {};

    if (body.amount !== undefined) {
      const amount = Number(body.amount);

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('El precio ofrecido debe ser mayor que cero');
      }

      data.amount = amount;
    }

    if (body.materialsAmount !== undefined) {
      const materialsAmount = Number(body.materialsAmount);

      if (!Number.isFinite(materialsAmount) || materialsAmount < 0) {
        throw new Error('El importe de materiales no es válido');
      }

      data.materialsAmount = materialsAmount;
    }

    if (body.includedScope !== undefined) {
      data.includedScope = body.includedScope?.trim() || null;
    }

    if (body.excludedScope !== undefined) {
      data.excludedScope = body.excludedScope?.trim() || null;
    }

    if (body.message !== undefined) {
      data.message = body.message?.trim() || null;
    }

    if (body.availableDate !== undefined) {
      data.availableDate = body.availableDate
        ? new Date(body.availableDate)
        : null;
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedProposal = await tx.proposal.update({
        where: { id: proposal.id },
        data: {
          ...data,
          status: 'PENDING'
        }
      });

      await tx.jobRequest.updateMany({
        where: {
          id: jobRequestId,
          status: 'PUBLISHED'
        },
        data: {
          status: 'RECEIVING_QUOTES'
        }
      });

      return updatedProposal;
    });
  }

  @Patch(':jobId/proposals/:proposalId/withdraw')
  async withdrawProposal(
    @Req() req: any,
    @Param('jobId') jobRequestId: string,
    @Param('proposalId') proposalId: string
  ) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      throw new Error('El usuario no tiene perfil de especialista');
    }

    const proposal = await this.prisma.proposal.findFirst({
      where: {
        id: proposalId,
        jobRequestId,
        specialistId: specialist.id,
        status: 'PENDING'
      }
    });

    if (!proposal) {
      throw new Error('La propuesta no existe, no te pertenece o ya no puede retirarse');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedProposal = await tx.proposal.update({
        where: { id: proposal.id },
        data: { status: 'WITHDRAWN' }
      });

      const pendingCount = await tx.proposal.count({
        where: {
          jobRequestId,
          status: 'PENDING'
        }
      });

      if (pendingCount === 0) {
        await tx.jobRequest.updateMany({
          where: {
            id: jobRequestId,
            status: 'RECEIVING_QUOTES'
          },
          data: {
            status: 'PUBLISHED'
          }
        });
      }

      return updatedProposal;
    });
  }

  @Get('available')
  async available(@Req() req: any) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId },
      include: {
        categories: true,
        serviceAreas: true,
        user: {
          select: {
            locations: true
          }
        }
      }
    });

    if (!specialist) {
      return [];
    }

    const categoryIds = specialist.categories.map(
      (x: any) => x.categoryId
    );

    if (categoryIds.length === 0) {
      return [];
    }

    const city = specialist.user?.locations?.[0]?.city?.trim();

    const areas = specialist.serviceAreas.map(area => ({
      centerLatitude: Number(area.centerLatitude),
      centerLongitude: Number(area.centerLongitude),
      radiusMiles: area.radiusMiles,
      isActive: area.isActive
    }));

    const hasConfiguredAreas = areas.length > 0;

    const jobs = await this.prisma.jobRequest.findMany({
      where: {
        status: {
          in: ['PUBLISHED', 'RECEIVING_QUOTES']
        },
        ...(categoryIds.length
          ? { categoryId: { in: categoryIds } }
          : {}),
        ...(!hasConfiguredAreas && city
          ? { city: { equals: city, mode: 'insensitive' } }
          : {})
      },
      include: {
        category: true,
        client: {
          select: {
            specialistReviews: {
              select: {
                rating: true
              }
            }
          }
        },
        proposals: {
          where: {
            specialistId: specialist.id
          },
          select: {
            id: true,
            status: true,
            amount: true,
            message: true,
            availableDate: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const publicJob = (job: typeof jobs[number]) => {
      const {
        serviceAddress,
        locationVerifiedAt,
        latitude,
        longitude,
        ...safeJob
      } = job;

      return safeJob;
    };

    if (!hasConfiguredAreas) {
      return jobs.map(publicJob);
    }

    const matches = jobs.flatMap(job => {
      const hasCoordinates =
        job.latitude !== null &&
        job.longitude !== null;

      if (!hasCoordinates) {
        const sameCity =
          Boolean(city) &&
          job.city.trim().toLowerCase() === city.toLowerCase();

        return sameCity
          ? [{
              ...publicJob(job),
              coverageDistanceMiles: null
            }]
          : [];
      }

      const coverage = evaluateCoverage(
        Number(job.latitude),
        Number(job.longitude),
        areas
      );

      if (!coverage.covered) {
        return [];
      }

      return [{
        ...publicJob(job),
        coverageDistanceMiles: coverage.distanceMiles
      }];
    });

    return matches.sort((a, b) => {
      if (a.coverageDistanceMiles === null) return 1;
      if (b.coverageDistanceMiles === null) return -1;

      return (
        a.coverageDistanceMiles -
        b.coverageDistanceMiles
      );
    });
  }

  @Patch(':jobId/proposals/:proposalId/reject')
  async rejectProposal(
    @Req() req: any,
    @Param('jobId') jobRequestId: string,
    @Param('proposalId') proposalId: string
  ) {
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      throw new Error('El usuario no tiene perfil de cliente');
    }

    return this.retryTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        const jobRequest = await tx.jobRequest.findFirst({
          where: {
            id: jobRequestId,
            clientId: client.id,
            status: { in: ['PUBLISHED', 'RECEIVING_QUOTES'] }
          }
        });

        if (!jobRequest) {
          throw new Error('La solicitud ya no permite rechazar propuestas');
        }

        const proposalResult = await tx.proposal.updateMany({
          where: {
            id: proposalId,
            jobRequestId,
            status: 'PENDING'
          },
          data: { status: 'REJECTED' }
        });

        if (proposalResult.count !== 1) {
          throw new Error('La propuesta ya no está pendiente');
        }

        const pendingCount = await tx.proposal.count({
          where: {
            jobRequestId,
            status: 'PENDING'
          }
        });

        if (pendingCount === 0) {
          await tx.jobRequest.updateMany({
            where: {
              id: jobRequestId,
              clientId: client.id,
              status: 'RECEIVING_QUOTES'
            },
            data: { status: 'PUBLISHED' }
          });
        }

        return tx.proposal.findUniqueOrThrow({
          where: { id: proposalId }
        });
      }, {
        isolationLevel: 'Serializable'
      })
    );
  }

  @Post(':jobId/proposals/:proposalId/accept')
  async acceptProposal(
    @Req() req: any,
    @Param('jobId') jobRequestId: string,
    @Param('proposalId') proposalId: string
  ) {
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      throw new Error('El usuario no tiene perfil de cliente');
    }

    return this.retryTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        const jobRequest = await tx.jobRequest.findFirst({
          where: {
            id: jobRequestId,
            clientId: client.id,
            status: { in: ['PUBLISHED', 'RECEIVING_QUOTES'] }
          }
        });

        if (!jobRequest) {
          throw new ConflictException('La solicitud ya no acepta propuestas');
        }

        const proposal = await tx.proposal.findFirst({
          where: {
            id: proposalId,
            jobRequestId,
            status: 'PENDING'
          }
        });

        if (!proposal) {
          throw new ConflictException('La propuesta ya no está disponible');
        }

        const jobResult = await tx.jobRequest.updateMany({
          where: {
            id: jobRequestId,
            clientId: client.id,
            status: { in: ['PUBLISHED', 'RECEIVING_QUOTES'] }
          },
          data: { status: 'PENDING_AGREEMENT' }
        });

        if (jobResult.count !== 1) {
          throw new ConflictException('Otro proceso ya seleccionó una propuesta');
        }

        const proposalResult = await tx.proposal.updateMany({
          where: {
            id: proposalId,
            jobRequestId,
            status: 'PENDING'
          },
          data: { status: 'SELECTED' }
        });

        if (proposalResult.count !== 1) {
          throw new ConflictException('La propuesta cambió de estado');
        }

        const latestWorkOrder = await tx.workOrder.findFirst({
          where: { jobRequestId },
          orderBy: { version: 'desc' },
          select: { version: true }
        });

        const nextWorkOrderVersion =
          (latestWorkOrder?.version ?? 0) + 1;

        await tx.workOrder.create({
          data: {
            jobRequestId,
            proposalId,
            negotiationId: crypto.randomUUID(),
            version: nextWorkOrderVersion,
            status: 'PENDING_ACCEPTANCE',
            title: jobRequest.title,
            description: jobRequest.description,
            includedScope: proposal.includedScope,
            excludedScope: proposal.excludedScope,
            city: jobRequest.city,
            state: jobRequest.state,
            zipcode: jobRequest.zipcode,
            scheduledDate:
              proposal.availableDate ?? jobRequest.desiredDate,
            laborAmount: proposal.amount,
            materialsAmount: proposal.materialsAmount,
            currency: 'USD',
            templateVersion: '0.1',
            reviewPeriodHours: 48,
            respondingParty: 'CLIENT',
            responseDeadline: new Date(
              Date.now() + 48 * 60 * 60 * 1000
            )
          }
        });

        return tx.proposal.findUnique({
          where: { id: proposalId },
          include: {
            specialist: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              }
            }
          }
        });
      }, {
        isolationLevel: 'Serializable'
      })
    );
  }

  @Post(':jobId/proposals/:proposalId/unselect')
  async unselectProposal(
    @Req() req: any,
    @Param('jobId') jobRequestId: string,
    @Param('proposalId') proposalId: string
  ) {
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      throw new Error('El usuario no tiene perfil de cliente');
    }

    return this.retryTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        const jobRequest = await tx.jobRequest.findFirst({
          where: {
            id: jobRequestId,
            clientId: client.id,
            status: 'PENDING_AGREEMENT'
          }
        });

        if (!jobRequest) {
          throw new ConflictException(
            'La solicitud ya no permite retirar la selección'
          );
        }

        const proposal = await tx.proposal.findFirst({
          where: {
            id: proposalId,
            jobRequestId,
            status: 'SELECTED'
          }
        });

        if (!proposal) {
          throw new ConflictException('La propuesta ya no está seleccionada');
        }

        const workOrder = await tx.workOrder.findFirst({
          where: {
            jobRequestId,
            proposalId
          },
          orderBy: { version: 'desc' }
        });

        if (!workOrder || workOrder.status !== 'PENDING_ACCEPTANCE') {
          throw new ConflictException(
            'La Orden de Trabajo ya no permite retirar la selección'
          );
        }

        const result = await tx.workOrder.updateMany({
          where: {
            id: workOrder.id,
            status: 'PENDING_ACCEPTANCE'
          },
          data: { status: 'CANCELLED' }
        });

        if (result.count !== 1) {
          throw new ConflictException('La Orden de Trabajo cambió de estado');
        }

        const proposalResult = await tx.proposal.updateMany({
          where: {
            id: proposalId,
            jobRequestId,
            status: 'SELECTED'
          },
          data: { status: 'PENDING' }
        });

        if (proposalResult.count !== 1) {
          throw new ConflictException('La propuesta cambió de estado');
        }

        const jobResult = await tx.jobRequest.updateMany({
          where: {
            id: jobRequestId,
            clientId: client.id,
            status: 'PENDING_AGREEMENT'
          },
          data: { status: 'RECEIVING_QUOTES' }
        });

        if (jobResult.count !== 1) {
          throw new ConflictException('La solicitud cambió de estado');
        }

        return tx.proposal.findUnique({
          where: { id: proposalId }
        });
      }, {
        isolationLevel: 'Serializable'
      })
    );
  }

  @Get(':jobId/work-orders/history')
  async getWorkOrderHistory(
    @Req() req: any,
    @Param('jobId') jobRequestId: string
  ) {
    const jobRequest = await this.prisma.jobRequest.findUnique({
      where: { id: jobRequestId },
      include: {
        client: true
      }
    });

    if (!jobRequest) {
      throw new Error('La solicitud no existe');
    }

    const isClient =
      jobRequest.client.userId === req.user.userId;

    if (isClient) {
      return this.prisma.workOrder.findMany({
        where: {
          jobRequestId
        },
        orderBy: {
          version: 'asc'
        },
        include: {
          proposal: {
            include: {
              specialist: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true
                    }
                  }
                }
              }
            }
          }
        }
      });
    }

    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      throw new Error(
        'No tienes acceso al historial de esta Orden de Trabajo'
      );
    }

    const history = await this.prisma.workOrder.findMany({
      where: {
        jobRequestId,
        proposal: {
          specialistId: specialist.id
        }
      },
      orderBy: {
        version: 'asc'
      }
    });

    if (history.length === 0) {
      throw new Error(
        'No tienes acceso al historial de esta Orden de Trabajo'
      );
    }

    return history;
  }

  @Get(':jobId/work-order')
  async getWorkOrder(
    @Req() req: any,
    @Param('jobId') jobRequestId: string
  ) {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: {
        jobRequestId,
        status: {
          in: ['PENDING_ACCEPTANCE', 'ACCEPTED']
        }
      },
      orderBy: {
        version: 'desc'
      },
      include: {
        jobRequest: {
          include: {
            client: true
          }
        },
        proposal: {
          include: {
            specialist: true
          }
        }
      }
    });

    if (!workOrder) {
      throw new NotFoundException('No existe una Orden de Trabajo para esta solicitud');
    }

    const isClient =
      workOrder.jobRequest.client.userId === req.user.userId;

    const isSpecialist =
      workOrder.proposal.specialist.userId === req.user.userId;

    if (!isClient && !isSpecialist) {
      throw new ForbiddenException('No tienes acceso a esta Orden de Trabajo');
    }

    const {
      serviceAddress,
      latitude,
      longitude,
      locationVerifiedAt,
      locationVerificationStatus,
      ...safeJobRequest
    } = workOrder.jobRequest;

    return {
      ...workOrder,
      jobRequest: safeJobRequest
    };
  }

  @Post(':jobId/work-order/revise')
  async reviseWorkOrder(
    @Req() req: any,
    @Param('jobId') jobRequestId: string,
    @Body() body: any
  ) {
    if (
      containsLikelyStreetAddress(body?.includedScope) ||
      containsLikelyStreetAddress(body?.excludedScope)
    ) {
      throw new BadRequestException(
        'Por privacidad, no incluyas una dirección exacta en los textos de la propuesta o de la Orden de Trabajo.'
      );
    }

    const workOrder = await this.prisma.workOrder.findFirst({
      where: {
        jobRequestId,
        status: 'PENDING_ACCEPTANCE',
        jobRequest: {
          status: 'PENDING_AGREEMENT'
        },
        proposal: {
          status: 'SELECTED'
        }
      },
      orderBy: {
        version: 'desc'
      },
      include: {
        jobRequest: {
          include: {
            client: true
          }
        },
        proposal: {
          include: {
            specialist: true
          }
        }
      }
    });

    if (!workOrder) {
      throw new Error(
        'No existe una Orden de Trabajo pendiente que pueda revisarse'
      );
    }

    const isClient =
      workOrder.jobRequest.client.userId === req.user.userId;

    const isSpecialist =
      workOrder.proposal.specialist.userId === req.user.userId;

    if (!isClient && !isSpecialist) {
      throw new Error('No tienes permiso para revisar esta Orden de Trabajo');
    }

    const allowedFields = [
      'includedScope',
      'excludedScope',
      'scheduledDate',
      'laborAmount',
      'materialsAmount',
      'reviewPeriodHours'
    ];

    const hasChanges = allowedFields.some((field) =>
      Object.prototype.hasOwnProperty.call(body, field)
    );

    if (!hasChanges) {
      throw new Error('No se recibieron cambios para la Orden de Trabajo');
    }

    let reviewPeriodHours = workOrder.reviewPeriodHours ?? 48;

    if (
      Object.prototype.hasOwnProperty.call(body, 'reviewPeriodHours')
    ) {
      if (
        body.reviewPeriodHours !== 48 &&
        body.reviewPeriodHours !== 168
      ) {
        throw new BadRequestException(
          'El plazo de revisión debe ser de 48 horas o 7 días'
        );
      }

      reviewPeriodHours = body.reviewPeriodHours;
    }

    let scheduledDate = workOrder.scheduledDate;

    if (Object.prototype.hasOwnProperty.call(body, 'scheduledDate')) {
      if (body.scheduledDate === null || body.scheduledDate === '') {
        scheduledDate = null;
      } else {
        const parsedDate = new Date(body.scheduledDate);

        if (Number.isNaN(parsedDate.getTime())) {
          throw new Error('La fecha programada no es válida');
        }

        scheduledDate = parsedDate;
      }
    }

    const laborAmount =
      Object.prototype.hasOwnProperty.call(body, 'laborAmount')
        ? Number(body.laborAmount)
        : Number(workOrder.laborAmount);

    const materialsAmount =
      Object.prototype.hasOwnProperty.call(body, 'materialsAmount')
        ? Number(body.materialsAmount)
        : Number(workOrder.materialsAmount);

    if (!Number.isFinite(laborAmount) || laborAmount < 0) {
      throw new Error('El importe de mano de obra no es válido');
    }

    if (!Number.isFinite(materialsAmount) || materialsAmount < 0) {
      throw new Error('El importe de materiales no es válido');
    }

    return this.retryTransaction(() =>
      this.prisma.$transaction(async (tx) => {
      const current = await tx.workOrder.findUnique({
        where: { id: workOrder.id }
      });

      if (!current || current.status !== 'PENDING_ACCEPTANCE') {
  throw new Error(
    'La Orden de Trabajo ya cambió y no puede revisarse'
  );
}

if (
  current.responseDeadline &&
  new Date() >= current.responseDeadline
) {
  throw new Error(
    'El plazo para modificar esta Orden de Trabajo ha vencido'
  );
}

      const latestWorkOrder = await tx.workOrder.findFirst({
        where: { jobRequestId },
        orderBy: { version: 'desc' },
        select: { version: true }
      });

      if (
        !latestWorkOrder ||
        latestWorkOrder.version !== current.version
      ) {
        throw new Error(
          'Existe una versión más reciente de la Orden de Trabajo'
        );
      }

      const jobRequest = await tx.jobRequest.findUnique({
        where: { id: jobRequestId },
        select: { status: true }
      });

      if (jobRequest?.status !== 'PENDING_AGREEMENT') {
        throw new Error(
          'La solicitud de servicio ya no está en negociación'
        );
      }

      const proposal = await tx.proposal.findUnique({
        where: { id: current.proposalId },
        select: { status: true }
      });

      if (proposal?.status !== 'SELECTED') {
        throw new Error(
          'La propuesta ya no está seleccionada'
        );
      }

      const nextWorkOrderVersion =
        latestWorkOrder.version + 1;

      const result = await tx.workOrder.updateMany({
        where: {
          id: current.id,
          status: 'PENDING_ACCEPTANCE',
          responseDeadline: { gt: new Date() }
        },
        data: { status: 'SUPERSEDED' }
      });

      if (result.count !== 1) {
        throw new Error(
          'La Orden de Trabajo cambió o su plazo ha vencido'
        );
      }

      return tx.workOrder.create({
        data: {
          jobRequestId,
          proposalId: workOrder.proposalId,
          negotiationId: workOrder.negotiationId,
          version: nextWorkOrderVersion,
          status: 'PENDING_ACCEPTANCE',
          title: workOrder.title,
          description: workOrder.description,
          includedScope:
            Object.prototype.hasOwnProperty.call(body, 'includedScope')
              ? body.includedScope
              : workOrder.includedScope,
          excludedScope:
            Object.prototype.hasOwnProperty.call(body, 'excludedScope')
              ? body.excludedScope
              : workOrder.excludedScope,
          city: workOrder.city,
          state: workOrder.state,
          zipcode: workOrder.zipcode,
          scheduledDate,
          laborAmount,
          materialsAmount,
          currency: workOrder.currency,
          templateVersion: workOrder.templateVersion,
          reviewPeriodHours,
          respondingParty: isClient ? 'SPECIALIST' : 'CLIENT',
          responseDeadline: new Date(
            Date.now() + 48 * 60 * 60 * 1000
          )
        }
      });
      }, {
        isolationLevel: 'Serializable'
      })
    );
  }

  @Post(':jobId/work-order/accept')
  async acceptWorkOrder(
    @Req() req: any,
    @Param('jobId') jobRequestId: string
  ) {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: {
        jobRequestId,
        status: 'PENDING_ACCEPTANCE',
        jobRequest: {
          status: 'PENDING_AGREEMENT'
        },
        proposal: {
          status: 'SELECTED'
        }
      },
      orderBy: {
        version: 'desc'
      },
      include: {
        jobRequest: {
          include: {
            client: true
          }
        },
        proposal: {
          include: {
            specialist: true
          }
        }
      }
    });

    if (!workOrder) {
      throw new ConflictException(
        'No existe una Orden de Trabajo pendiente de aceptación'
      );
    }

    const isClient =
      workOrder.jobRequest.client.userId === req.user.userId;

    const isSpecialist =
      workOrder.proposal.specialist.userId === req.user.userId;

    if (!isClient && !isSpecialist) {
      throw new Error('No tienes permiso para aceptar esta Orden de Trabajo');
    }

    return this.retryTransaction(() =>
      this.prisma.$transaction(async (tx) => {
      const current = await tx.workOrder.findUnique({
        where: { id: workOrder.id }
      });

      if (!current) {
  throw new ConflictException('La Orden de Trabajo ya no existe');
}

if (current.status !== 'PENDING_ACCEPTANCE') {
  throw new ConflictException(
    'Esta Orden de Trabajo ya no está pendiente de aceptación'
  );
}

if (
  current.responseDeadline &&
  new Date() >= current.responseDeadline
) {
  throw new ConflictException(
    'El plazo para aceptar esta Orden de Trabajo ha vencido'
  );
}

const latestWorkOrder = await tx.workOrder.findFirst({
  where: { jobRequestId },
  orderBy: { version: 'desc' },
  select: { id: true }
});

if (!latestWorkOrder || latestWorkOrder.id !== current.id) {
  throw new ConflictException(
    'Existe una versión más reciente de la Orden de Trabajo'
  );
}

const jobRequest = await tx.jobRequest.findUnique({
  where: { id: jobRequestId },
  select: { status: true }
});

if (jobRequest?.status !== 'PENDING_AGREEMENT') {
  throw new ConflictException(
    'La solicitud de servicio ya no está en negociación'
  );
}

const proposal = await tx.proposal.findUnique({
  where: { id: current.proposalId },
  select: { status: true }
});

if (proposal?.status !== 'SELECTED') {
  throw new ConflictException(
    'La propuesta ya no está seleccionada'
  );
}

const data: any = {};

      if (isClient && !current.clientAcceptedAt) {
        data.clientAcceptedAt = new Date();
      }

      if (isSpecialist && !current.specialistAcceptedAt) {
        data.specialistAcceptedAt = new Date();
      }

      const result = await tx.workOrder.updateMany({
        where: {
          id: current.id,
          status: 'PENDING_ACCEPTANCE',
          responseDeadline: { gt: new Date() }
        },
        data
      });

      if (result.count !== 1) {
        throw new ConflictException(
          'La Orden de Trabajo cambió o su plazo ha vencido'
        );
      }

      const updated = await tx.workOrder.findUniqueOrThrow({
        where: { id: current.id }
      });

      if (
        updated.clientAcceptedAt &&
        updated.specialistAcceptedAt
      ) {
        await tx.workOrder.update({
          where: { id: workOrder.id },
          data: { status: 'ACCEPTED' }
        });

        await tx.proposal.update({
          where: { id: workOrder.proposalId },
          data: { status: 'ACCEPTED' }
        });

        await tx.proposal.updateMany({
          where: {
            jobRequestId,
            id: { not: workOrder.proposalId },
            status: 'PENDING'
          },
          data: { status: 'REJECTED' }
        });

        const existingPayment = await tx.payment.findUnique({
          where: { jobRequestId }
        });

        if (!existingPayment) {
          await tx.payment.create({
            data: {
              jobRequestId,
              proposalId: workOrder.proposalId,
              clientId: workOrder.jobRequest.clientId,
              specialistId: workOrder.proposal.specialistId,
              amount:
                Number(updated.laborAmount) +
                Number(updated.materialsAmount),
              currency: updated.currency,
              status: 'PENDING'
            }
          });
        }

        if (
          updated.reviewPeriodHours !== 48 &&
          updated.reviewPeriodHours !== 168
        ) {
          throw new ConflictException(
            'La Orden de Trabajo no tiene un plazo de revisión válido'
          );
        }

        await tx.jobRequest.update({
          where: { id: jobRequestId },
          data: {
            status: 'AWAITING_PAYMENT',
            reviewPeriodHours: updated.reviewPeriodHours
          }
        });
      }

      return tx.workOrder.findUnique({
        where: { id: workOrder.id }
      });
      }, {
        isolationLevel: 'Serializable'
      })
    );
  }

  @Post(':jobId/work-order/extension/request')
  async requestWorkOrderExtension(
    @Req() req: any,
    @Param('jobId') jobRequestId: string
  ) {
    return this.retryTransaction(() =>
      this.prisma.$transaction(async (tx) => {
      const workOrder = await tx.workOrder.findFirst({
        where: {
          jobRequestId,
          status: 'PENDING_ACCEPTANCE',
          jobRequest: {
            status: 'PENDING_AGREEMENT'
          },
          proposal: {
            status: 'SELECTED'
          }
        },
        orderBy: { version: 'desc' },
        include: {
          jobRequest: { include: { client: true } },
          proposal: { include: { specialist: true } }
        }
      });

      if (!workOrder) {
        throw new Error('No existe una negociación activa');
      }

      const isClient =
        workOrder.jobRequest.client.userId === req.user.userId;

      const isSpecialist =
        workOrder.proposal.specialist.userId === req.user.userId;

      if (!isClient && !isSpecialist) {
        throw new Error('No tienes permiso para solicitar la prórroga');
      }

      if (
        (workOrder.respondingParty === 'CLIENT' && !isClient) ||
        (workOrder.respondingParty === 'SPECIALIST' && !isSpecialist)
      ) {
        throw new Error(
          'Sólo la parte que debe responder puede solicitar la prórroga'
        );
      }

      if (
        !workOrder.responseDeadline ||
        new Date() >= workOrder.responseDeadline
      ) {
        throw new Error('El plazo de negociación ya venció');
      }

      if (!workOrder.negotiationId) {
        throw new Error(
          'La Orden de Trabajo no tiene identificador de negociación'
        );
      }

      const previousExtension = await tx.workOrder.findFirst({
        where: {
          negotiationId: workOrder.negotiationId,
          extensionRequestedAt: { not: null }
        }
      });

      if (previousExtension) {
        throw new Error(
          'Ya se solicitó la única prórroga permitida en esta negociación'
        );
      }

const result = await tx.workOrder.updateMany({
  where: {
    id: workOrder.id,
    status: 'PENDING_ACCEPTANCE',
    extensionApprovedAt: null,
    responseDeadline: { gt: new Date() },
    extensionRequestedAt: null,
    extensionRejectedAt: null
  },
  data: {
    extensionRequestedAt: new Date(),
    extensionRejectedAt: null
  }
});
      if (result.count !== 1) {
        throw new Error(
          'No fue posible registrar la solicitud de prórroga'
        );
      }

return {
        message: 'Solicitud de prórroga registrada. Pendiente de aprobación.',
        workOrderId: workOrder.id
      };
      }, {
        isolationLevel: 'Serializable'
      })
    );
  }
      @Post(':jobId/work-order/extension/respond')
  async respondWorkOrderExtension(
    @Req() req: any,
    @Param('jobId') jobRequestId: string,
    @Body() body: any
  ) {
    if (
      typeof body?.approve !== 'boolean'
    ) {
      throw new Error('Debes indicar approve: true o false');
    }

    return this.retryTransaction(() =>
      this.prisma.$transaction(async (tx) => {
      const workOrder = await tx.workOrder.findFirst({
        where: {
          jobRequestId,
          status: 'PENDING_ACCEPTANCE',
          jobRequest: { status: 'PENDING_AGREEMENT' },
          proposal: { status: 'SELECTED' }
        },
        orderBy: { version: 'desc' },
        include: {
          jobRequest: { include: { client: true } },
          proposal: { include: { specialist: true } }
        }
      });

      if (!workOrder) {
        throw new Error('No existe una negociación activa');
      }

      const isClient =
        workOrder.jobRequest.client.userId === req.user.userId;

      const isSpecialist =
        workOrder.proposal.specialist.userId === req.user.userId;

      const authorized =
        (workOrder.respondingParty === 'CLIENT' && isSpecialist) ||
        (workOrder.respondingParty === 'SPECIALIST' && isClient);

      if (!authorized) {
        throw new Error(
          'Sólo la contraparte puede responder a la solicitud'
        );
      }

      if (
        !workOrder.extensionRequestedAt ||
        workOrder.extensionRejectedAt ||
        workOrder.extensionApprovedAt
      ) {
        throw new Error(
          'No existe una solicitud de prórroga pendiente'
        );
      }

      if (
        !workOrder.responseDeadline ||
        new Date() >= workOrder.responseDeadline
      ) {
        throw new Error('El plazo original ya venció');
      }

      if (body.approve) {
        if (!workOrder.negotiationId) {
          throw new Error(
            'La Orden de Trabajo no tiene identificador de negociación'
          );
        }

        const previousApproval = await tx.workOrder.findFirst({
          where: {
            negotiationId: workOrder.negotiationId,
            extensionApprovedAt: { not: null }
          }
        });

        if (previousApproval) {
          throw new Error(
            'Ya se concedió una prórroga en esta negociación'
          );
        }
      }

      const now = new Date();

      const result = await tx.workOrder.updateMany({
        where: {
          id: workOrder.id,
          status: 'PENDING_ACCEPTANCE',
          extensionRequestedAt: { not: null },
          extensionApprovedAt: null,
          extensionRejectedAt: null,
          responseDeadline: { gt: now }
        },
        data: body.approve
          ? {
              extensionApprovedAt: now,
              responseDeadline: new Date(
                workOrder.responseDeadline.getTime() +
                24 * 60 * 60 * 1000
              )
            }
          : {
              extensionRejectedAt: now
            }
      });

      if (result.count !== 1) {
        throw new Error(
          'La solicitud ya fue respondida o cambió de estado'
        );
      }

      return {
        message: body.approve
          ? 'Prórroga de 24 horas aprobada'
          : 'Prórroga rechazada',
        workOrderId: workOrder.id
      };
      }, {
        isolationLevel: 'Serializable'
      })
    );
  }
    @Post(':jobId/payment/confirm')
  async confirmPayment(
    @Req() req: any,
    @Param('jobId') jobRequestId: string
  ) {
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      throw new Error('El usuario no tiene perfil de cliente');
    }

    const payment = await this.prisma.payment.findFirst({
      where: {
        jobRequestId,
        clientId: client.id,
        status: 'PENDING',
        jobRequest: {
          status: 'AWAITING_PAYMENT'
        }
      }
    });

    if (!payment) {
      throw new Error('No existe un pago pendiente para esta solicitud');
    }

    if (process.env.INTERNAL_MVP_PAYMENTS_ENABLED !== 'true') {
      throw new Error(
        'Los pagos simulados no están habilitados'
      );
    }

    return this.retryTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        const updatedPayment = await tx.payment.updateMany({
          where: {
            id: payment.id,
            clientId: client.id,
            status: 'PENDING'
          },
          data: {
            status: 'PAID',
            provider: 'INTERNAL_MVP',
            paidAt: new Date()
          }
        });

        if (updatedPayment.count !== 1) {
          throw new Error('El pago ya cambió de estado');
        }

        const updatedJob = await tx.jobRequest.updateMany({
          where: {
            id: jobRequestId,
            clientId: client.id,
            status: 'AWAITING_PAYMENT'
          },
          data: { status: 'ASSIGNED' }
        });

        if (updatedJob.count !== 1) {
          throw new Error('La solicitud ya cambió de estado');
        }

        return tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
          select: {
            id: true,
            jobRequestId: true,
            amount: true,
            currency: true,
            status: true,
            paidAt: true,
            releasedAt: true
          }
        });
      }, {
        isolationLevel: 'Serializable'
      })
    );
  }

  @Patch('specialist/my-jobs/:id/start')
  async startSpecialistJob(
    @Req() req: any,
    @Param('id') jobRequestId: string
  ) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      throw new Error('El usuario no tiene perfil de especialista');
    }

    const jobRequest = await this.prisma.jobRequest.findFirst({
      where: {
        id: jobRequestId,
        status: 'ASSIGNED',
        proposals: {
          some: {
            specialistId: specialist.id,
            status: 'ACCEPTED'
          }
        }
      },
      include: {
        payment: true
      }
    });

    if (!jobRequest) {
      throw new Error('El trabajo no está asignado a este especialista o no puede iniciarse');
    }

    if (!jobRequest.payment || jobRequest.payment.status !== 'PAID') {
      throw new Error(
        'El trabajo no puede iniciarse hasta que el pago esté confirmado'
      );
    }

    const started = await this.prisma.jobRequest.updateMany({
      where: {
        id: jobRequestId,
        status: 'ASSIGNED',
        proposals: {
          some: {
            specialistId: specialist.id,
            status: 'ACCEPTED'
          }
        },
        payment: {
          is: {
            status: 'PAID'
          }
        }
      },
      data: { status: 'IN_PROGRESS' }
    });

    if (started.count !== 1) {
      throw new ConflictException(
        'El trabajo cambió de estado y no puede iniciarse nuevamente'
      );
    }

    const updatedJob = await this.prisma.jobRequest.findUnique({
      where: { id: jobRequestId }
    });

    if (!updatedJob) {
      throw new Error('El trabajo no está disponible');
    }

    const {
      serviceAddress,
      latitude,
      longitude,
      locationVerifiedAt,
      ...safeJob
    } = updatedJob;

    return safeJob;
  }

  @Patch('specialist/my-jobs/:id/complete')
  async completeSpecialistJob(
    @Req() req: any,
    @Param('id') jobRequestId: string
  ) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      throw new Error('El usuario no tiene perfil de especialista');
    }

    const jobRequest = await this.prisma.jobRequest.findFirst({
      where: {
        id: jobRequestId,
        status: 'IN_PROGRESS',
        proposals: {
          some: {
            specialistId: specialist.id,
            status: 'ACCEPTED'
          }
        }
      }
    });

    if (!jobRequest) {
      throw new Error('El trabajo no está en progreso o no pertenece a este especialista');
    }

    const reviewPeriodHours = jobRequest.reviewPeriodHours;

    if (
      reviewPeriodHours !== 48 &&
      reviewPeriodHours !== 168
    ) {
      throw new ConflictException(
        'El trabajo no tiene un plazo de revisión válido'
      );
    }

    const workCompletedAt = new Date();
    const reviewDeadline = new Date(
      workCompletedAt.getTime() +
      reviewPeriodHours * 60 * 60 * 1000
    );

    const completed = await this.prisma.jobRequest.updateMany({
      where: {
        id: jobRequestId,
        status: 'IN_PROGRESS',
        proposals: {
          some: {
            specialistId: specialist.id,
            status: 'ACCEPTED'
          }
        }
      },
      data: {
        status: 'AWAITING_CLIENT_CONFIRMATION',
        workCompletedAt,
        reviewDeadline
      }
    });

    if (completed.count !== 1) {
      throw new ConflictException(
        'El trabajo cambió de estado y no puede finalizarse nuevamente'
      );
    }

    const updatedJob = await this.prisma.jobRequest.findUnique({
      where: { id: jobRequestId }
    });

    if (!updatedJob) {
      throw new Error('El trabajo no está disponible');
    }

    const {
      serviceAddress,
      latitude,
      longitude,
      locationVerifiedAt,
      ...safeJob
    } = updatedJob;

    return safeJob;
  }

  @Post('specialist/my-jobs/:id/review')
  async createSpecialistReview(
    @Req() req: any,
    @Param('id') jobRequestId: string,
    @Body() body: any
  ) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      throw new Error('El usuario no tiene perfil de especialista');
    }

    const rating = Number(body.rating);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('La calificación debe ser un número entero entre 1 y 5');
    }

    const jobRequest = await this.prisma.jobRequest.findFirst({
      where: {
        id: jobRequestId,
        status: 'COMPLETED',
        proposals: {
          some: {
            specialistId: specialist.id,
            status: 'ACCEPTED'
          }
        }
      },
      include: {
        specialistReview: true
      }
    });

    if (!jobRequest) {
      throw new Error('El trabajo no está completado o no pertenece a este especialista');
    }

    if (jobRequest.specialistReview) {
      throw new Error('Este cliente ya fue calificado para este trabajo');
    }

    return this.prisma.specialistReview.create({
      data: {
        jobRequestId: jobRequest.id,
        specialistId: specialist.id,
        clientId: jobRequest.clientId,
        rating,
        comment: body.comment?.trim() || null
      }
    });
  }

  @Get('specialist/my-jobs')
  async getSpecialistMyJobs(@Req() req: any) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      return [];
    }

    const jobs = await this.prisma.jobRequest.findMany({
      where: {
        status: {
          in: [
            'PENDING_AGREEMENT',
            'AWAITING_PAYMENT',
            'ASSIGNED',
            'IN_PROGRESS',
            'AWAITING_CLIENT_CONFIRMATION',
            'TERMINATION_REQUESTED',
            'DISPUTED',
            'CANCELLED',
            'COMPLETED'
          ]
        },
        proposals: {
          some: {
            specialistId: specialist.id,
            status: {
              in: ['SELECTED', 'ACCEPTED']
            }
          }
        }
      },
      include: {
        category: true,
        specialistReview: true,
        terminationRequest: {
          include: { damageClaims: true }
        },
        client: {
          select: {
            user: {
              select: {
                name: true,
                email: true,
                phone: true
              }
            }
          }
        },
        proposals: {
          where: {
            specialistId: specialist.id,
            status: {
              in: ['SELECTED', 'ACCEPTED']
            }
          },
          select: {
            id: true,
            amount: true,
            message: true,
            availableDate: true,
            status: true
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    return jobs.map(job => {
      const {
        serviceAddress,
        locationVerifiedAt,
        latitude,
        longitude,
        ...safeJob
      } = job;

      return safeJob;
    });
  }

  @Get(':id/proposals')
  async getProposals(
    @Req() req: any,
    @Param('id') jobRequestId: string
  ) {
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      throw new Error('El usuario no tiene perfil de cliente');
    }

    const jobRequest = await this.prisma.jobRequest.findFirst({
      where: {
        id: jobRequestId,
        clientId: client.id
      }
    });

    if (!jobRequest) {
      throw new ForbiddenException(
        'No tienes autorización para consultar estas propuestas'
      );
    }

    return this.prisma.proposal.findMany({
      where: {
        jobRequestId
      },
      include: {
        specialist: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  @Get(':id/completion-claims')
  async getCompletionClaims(
    @Req() req: any,
    @Param('id') jobRequestId: string
  ) {
    const userId = req.user.userId;

    const job = await this.prisma.jobRequest.findUnique({
      where: { id: jobRequestId },
      select: {
        id: true,
        client: {
          select: { userId: true }
        },
        proposals: {
          where: { status: 'ACCEPTED' },
          select: {
            specialist: {
              select: { userId: true }
            }
          }
        }
      }
    });

    if (!job) {
      throw new NotFoundException(
        'El trabajo no existe'
      );
    }

    const isClient = job.client.userId === userId;

    const isSpecialist = job.proposals.some(
      proposal => proposal.specialist.userId === userId
    );

    if (!isClient && !isSpecialist) {
      throw new ForbiddenException(
        'No tienes autorización para consultar estas reclamaciones'
      );
    }

    return this.prisma.completionClaim.findMany({
      where: { jobRequestId },
      select: {
        id: true,
        jobRequestId: true,
        description: true,
        status: true,
        specialistResponseNotes: true,
        specialistRespondedAt: true,
        resolutionNotes: true,
        resolvedAt: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  @Post(':id/completion-claims')
  async createCompletionClaim(
    @Req() req: any,
    @Param('id') jobRequestId: string,
    @Body() body: any
  ) {
    const description = String(body?.description ?? '').trim();

    if (description.length < 10 || description.length > 4000) {
      throw new BadRequestException(
        'La reclamación debe contener entre 10 y 4000 caracteres'
      );
    }

    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      throw new BadRequestException(
        'El usuario no tiene perfil de cliente'
      );
    }

    return this.retryTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        const lockedJobs = await tx.$queryRaw`
          SELECT "id"
          FROM "JobRequest"
          WHERE "id" = ${jobRequestId}
          FOR UPDATE
        `;

        if (!Array.isArray(lockedJobs) || lockedJobs.length !== 1) {
          throw new ConflictException(
            'El trabajo ya no está disponible'
          );
        }

        const job = await tx.jobRequest.findFirst({
          where: {
            id: jobRequestId,
            clientId: client.id,
            status: 'AWAITING_CLIENT_CONFIRMATION'
          },
          select: {
            id: true,
            reviewDeadline: true
          }
        });

        if (!job) {
          throw new ConflictException(
            'El trabajo no está pendiente de revisión'
          );
        }

        if (
          !job.reviewDeadline ||
          new Date() >= job.reviewDeadline
        ) {
          throw new ConflictException(
            'El plazo para presentar la reclamación ha vencido'
          );
        }

        const openClaims = await tx.completionClaim.count({
          where: {
            jobRequestId,
            status: {
              in: ['PENDING', 'CORRECTION_REQUESTED', 'DISPUTED']
            }
          }
        });

        if (openClaims > 0) {
          throw new ConflictException(
            'Ya existe una reclamación de revisión pendiente'
          );
        }

        return tx.completionClaim.create({
          data: {
            jobRequestId,
            clientId: client.id,
            description,
            status: 'PENDING'
          }
        });
      }, { isolationLevel: 'Serializable' })
    );
  }

  @Post(':id/completion-claims/:claimId/respond')
  async respondCompletionClaim(
    @Req() req: any,
    @Param('id') jobRequestId: string,
    @Param('claimId') claimId: string,
    @Body() body: any
  ) {
    const action = String(body?.action ?? '').trim().toUpperCase();
    const notes = String(body?.notes ?? '').trim();

    if (!['ACCEPT_CORRECTION', 'DISPUTE'].includes(action)) {
      throw new BadRequestException(
        'La respuesta debe ser ACCEPT_CORRECTION o DISPUTE'
      );
    }

    if (notes.length < 10 || notes.length > 4000) {
      throw new BadRequestException(
        'La explicación debe contener entre 10 y 4000 caracteres'
      );
    }

    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      throw new BadRequestException(
        'El usuario no tiene perfil de especialista'
      );
    }

    return this.retryTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        const lockedJobs = await tx.$queryRaw`
          SELECT "id"
          FROM "JobRequest"
          WHERE "id" = ${jobRequestId}
          FOR UPDATE
        `;

        if (!Array.isArray(lockedJobs) || lockedJobs.length !== 1) {
          throw new ConflictException(
            'El trabajo ya no está disponible'
          );
        }

        const job = await tx.jobRequest.findFirst({
          where: {
            id: jobRequestId,
            status: 'AWAITING_CLIENT_CONFIRMATION',
            proposals: {
              some: {
                specialistId: specialist.id,
                status: 'ACCEPTED'
              }
            }
          },
          select: { id: true }
        });

        if (!job) {
          throw new ConflictException(
            'Solo el especialista contratado puede responder'
          );
        }

        const claim = await tx.completionClaim.findFirst({
          where: {
            id: claimId,
            jobRequestId,
            status: 'PENDING'
          },
          select: { id: true }
        });

        if (!claim) {
          throw new ConflictException(
            'La reclamación no existe o ya fue respondida'
          );
        }

        const status = action === 'ACCEPT_CORRECTION'
          ? 'CORRECTION_REQUESTED'
          : 'DISPUTED';

        const updated = await tx.completionClaim.updateMany({
          where: {
            id: claimId,
            jobRequestId,
            status: 'PENDING'
          },
          data: {
            status,
            specialistResponseNotes: notes,
            specialistRespondedAt: new Date()
          }
        });

        if (updated.count !== 1) {
          throw new ConflictException(
            'La reclamación cambió de estado'
          );
        }

        return tx.completionClaim.findUniqueOrThrow({
          where: { id: claimId }
        });
      }, { isolationLevel: 'Serializable' })
    );
  }

  @Post(':id/complete/confirm')
  async confirmJobCompletion(
    @Req() req: any,
    @Param('id') jobRequestId: string
  ) {
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      throw new Error('El usuario no tiene perfil de cliente');
    }

    const jobRequest = await this.prisma.jobRequest.findFirst({
      where: {
        id: jobRequestId,
        clientId: client.id,
        status: 'AWAITING_CLIENT_CONFIRMATION'
      },
      include: {
        payment: true
      }
    });

    if (!jobRequest) {
      throw new Error('El trabajo no está pendiente de confirmación o no pertenece al cliente');
    }

    if (!jobRequest.payment || jobRequest.payment.status !== 'PAID') {
      throw new Error('El pago del trabajo no está listo para liberarse');
    }

    if (process.env.INTERNAL_MVP_PAYMENTS_ENABLED !== 'true') {
      throw new Error(
        'La liberación simulada de pagos no está habilitada'
      );
    }

    if (jobRequest.payment.provider !== 'INTERNAL_MVP') {
      throw new Error(
        'Este pago requiere confirmación del proveedor externo'
      );
    }

    return this.retryTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        const lockedJobs = await tx.$queryRaw`
          SELECT "id"
          FROM "JobRequest"
          WHERE "id" = ${jobRequestId}
          FOR UPDATE
        `;

        if (!Array.isArray(lockedJobs) || lockedJobs.length !== 1) {
          throw new ConflictException(
            'El trabajo ya no está disponible'
          );
        }

        const currentJob = await tx.jobRequest.findFirst({
          where: {
            id: jobRequestId,
            clientId: client.id,
            status: 'AWAITING_CLIENT_CONFIRMATION'
          },
          include: { payment: true }
        });

        if (
          !currentJob ||
          !currentJob.payment ||
          currentJob.payment.status !== 'PAID' ||
          currentJob.payment.provider !== 'INTERNAL_MVP'
        ) {
          throw new ConflictException(
            'El trabajo o su pago cambiaron antes de la confirmación'
          );
        }

        const openClaims = await tx.completionClaim.count({
          where: {
            jobRequestId,
            status: {
              in: ['PENDING', 'CORRECTION_REQUESTED', 'DISPUTED']
            }
          }
        });

        if (openClaims > 0) {
          throw new ConflictException(
            'El trabajo tiene una reclamación de revisión pendiente'
          );
        }

        const updatedPayment = await tx.payment.updateMany({
          where: {
            id: currentJob.payment.id,
            clientId: client.id,
            status: 'PAID',
            provider: 'INTERNAL_MVP'
          },
          data: {
            status: 'RELEASED',
            releasedAt: new Date()
          }
        });

        if (updatedPayment.count !== 1) {
          throw new Error(
            'El pago ya cambió de estado'
          );
        }

        const updatedJob = await tx.jobRequest.updateMany({
          where: {
            id: jobRequestId,
            clientId: client.id,
            status: 'AWAITING_CLIENT_CONFIRMATION'
          },
          data: { status: 'COMPLETED' }
        });

        if (updatedJob.count !== 1) {
          throw new Error(
            'El trabajo ya cambió de estado'
          );
        }

        const completedJob = await tx.jobRequest.findUniqueOrThrow({
          where: { id: jobRequestId }
        });

        const {
          latitude: privateLatitude,
          longitude: privateLongitude,
          locationVerifiedAt: privateVerificationDate,
          ...clientJob
        } = completedJob;

        return clientJob;
      }, {
        isolationLevel: 'Serializable'
      })
    );
  }

  @Post(':id/review')
  async createReview(
    @Req() req: any,
    @Param('id') jobRequestId: string,
    @Body() body: any
  ) {
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      throw new Error('El usuario no tiene perfil de cliente');
    }

    const rating = Number(body.rating);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('La calificación debe ser un número entero entre 1 y 5');
    }

    const jobRequest = await this.prisma.jobRequest.findFirst({
      where: {
        id: jobRequestId,
        clientId: client.id,
        status: 'COMPLETED'
      },
      include: {
        proposals: {
          where: {
            status: 'ACCEPTED'
          },
          select: {
            specialistId: true
          }
        },
        review: true
      }
    });

    if (!jobRequest) {
      throw new Error('El trabajo no existe, no pertenece al cliente o no está completado');
    }

    if (jobRequest.review) {
      throw new Error('Este trabajo ya fue calificado');
    }

    const acceptedProposal = jobRequest.proposals[0];

    if (!acceptedProposal) {
      throw new Error('No se encontró al especialista contratado');
    }

    return this.prisma.review.create({
      data: {
        jobRequestId: jobRequest.id,
        clientId: client.id,
        specialistId: acceptedProposal.specialistId,
        rating,
        comment: body.comment?.trim() || null
      }
    });
  }

  @Patch(':id')
  async updateJobRequest(
    @Req() req: any,
    @Param('id') jobRequestId: string,
    @Body() body: any
  ) {
    if (
      containsLikelyStreetAddress(body?.title) ||
      containsLikelyStreetAddress(body?.description)
    ) {
      throw new BadRequestException(
        'Por privacidad, no incluyas una dirección exacta en el título o la descripción. La dirección del servicio se proporcionará por separado.'
      );
    }
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      throw new Error('El usuario no tiene perfil de cliente');
    }

    const jobRequest = await this.prisma.jobRequest.findFirst({
      where: {
        id: jobRequestId,
        clientId: client.id,
        status: {
          in: ['DRAFT', 'PUBLISHED']
        }
      }
    });

    if (!jobRequest) {
      throw new Error(
        'La solicitud no existe, no te pertenece o ya no puede editarse'
      );
    }

    const data: any = {};

    if (body.title !== undefined) {
      const title = String(body.title).trim();

      if (!title) {
        throw new Error('El título no puede estar vacío');
      }

      data.title = title;
    }

    if (body.description !== undefined) {
      const description = String(body.description).trim();

      if (!description) {
        throw new Error('La descripción no puede estar vacía');
      }

      data.description = description;
    }

    if (
      (body.budgetMin != null && body.budgetMin !== '') ||
      (body.budgetMax != null && body.budgetMax !== '')
    ) {
      throw new Error(
        'El cliente no puede establecer un presupuesto inicial'
      );
    }

    data.budgetMin = null;
    data.budgetMax = null;

    if (
      data.budgetMin !== undefined &&
      data.budgetMin !== null &&
      (!Number.isFinite(data.budgetMin) || data.budgetMin < 0)
    ) {
      throw new Error('El presupuesto mínimo no es válido');
    }

    if (
      data.budgetMax !== undefined &&
      data.budgetMax !== null &&
      (!Number.isFinite(data.budgetMax) || data.budgetMax < 0)
    ) {
      throw new Error('El presupuesto máximo no es válido');
    }

    if (body.city !== undefined) {
      data.city = String(body.city).trim();
    }

    if (body.state !== undefined) {
      data.state = String(body.state).trim();
    }

    if (body.zipcode !== undefined) {
      data.zipcode = String(body.zipcode).trim();
    }

    if (body.desiredDate !== undefined) {
      data.desiredDate = body.desiredDate
        ? new Date(body.desiredDate)
        : null;
    }

    const updatedJob = await this.prisma.jobRequest.update({
      where: { id: jobRequest.id },
      data
    });

    const {
      latitude,
      longitude,
      locationVerifiedAt,
      ...clientJob
    } = updatedJob;

    return clientJob;
  }

  @Patch(':id/cancel')
  async cancelJobRequest(
    @Req() req: any,
    @Param('id') jobRequestId: string
  ) {
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      throw new Error('El usuario no tiene perfil de cliente');
    }

    const jobRequest = await this.prisma.jobRequest.findFirst({
      where: {
        id: jobRequestId,
        clientId: client.id,
        status: {
          in: ['DRAFT', 'PUBLISHED', 'RECEIVING_QUOTES']
        }
      }
    });

    if (!jobRequest) {
      throw new Error(
        'La solicitud no puede cancelarse porque ya fue asignada, está en proceso o terminó'
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.proposal.updateMany({
        where: {
          jobRequestId,
          status: 'PENDING'
        },
        data: {
          status: 'REJECTED'
        }
      });

      const cancelledJob = await tx.jobRequest.update({
        where: { id: jobRequestId },
        data: { status: 'CANCELLED' }
      });

      const {
        latitude,
        longitude,
        locationVerifiedAt,
        ...clientJob
      } = cancelledJob;

      return clientJob;
    });
  }

  @Post(':id/termination-request')
  async requestTermination(
    @Req() req: any,
    @Param('id') jobRequestId: string,
    @Body() body: any
  ) {
    const reasonCode = String(body.reasonCode || '').trim();
    const reasonDetails = body.reasonDetails
      ? String(body.reasonDetails).trim()
      : null;

    const claimedLiabilityRaw = String(
      body.claimedLiability || ''
    ).trim().toUpperCase();

    let claimedLiability:
      | 'CLIENT'
      | 'SPECIALIST'
      | 'NONE'
      | 'UNDETERMINED' = 'UNDETERMINED';

    if (claimedLiabilityRaw) {
      if (
        !['CLIENT', 'SPECIALIST', 'NONE'].includes(
          claimedLiabilityRaw
        )
      ) {
        throw new Error(
          'La responsabilidad reclamada debe ser CLIENT, SPECIALIST o NONE'
        );
      }

      claimedLiability = claimedLiabilityRaw as
        | 'CLIENT'
        | 'SPECIALIST'
        | 'NONE';
    }

    if (!reasonCode) {
      throw new Error('Debes indicar la causa de la terminación');
    }

    const jobRequest = await this.prisma.jobRequest.findUnique({
      where: { id: jobRequestId },
      include: {
        client: true,
        proposals: {
          where: { status: 'ACCEPTED' },
          include: {
            specialist: true
          }
        },
        terminationRequest: true
      }
    });

    if (!jobRequest) {
      throw new Error('El trabajo no existe');
    }

    if (
      !['AWAITING_PAYMENT', 'ASSIGNED', 'IN_PROGRESS'].includes(
        jobRequest.status
      )
    ) {
      throw new Error(
        'Este trabajo no se encuentra en una etapa que permita solicitar terminación'
      );
    }

    if (jobRequest.terminationRequest) {
      throw new Error('Ya existe una solicitud de terminación para este trabajo');
    }

    if (
      jobRequest.status === 'IN_PROGRESS' &&
      claimedLiability === 'UNDETERMINED'
    ) {
      throw new Error(
        'Debes indicar a quién atribuyes la responsabilidad de la terminación'
      );
    }

    let requesterRole: 'CLIENT' | 'SPECIALIST';

    if (jobRequest.client.userId === req.user.userId) {
      requesterRole = 'CLIENT';
    } else {
      const acceptedProposal = jobRequest.proposals.find(
        (proposal) => proposal.specialist.userId === req.user.userId
      );

      if (!acceptedProposal) {
        throw new Error('No tienes autorización para terminar este trabajo');
      }

      requesterRole = 'SPECIALIST';
    }

    return this.prisma.$transaction(async (tx) => {
      const terminationRequest = await tx.terminationRequest.create({
        data: {
          jobRequestId,
          requestedById: req.user.userId,
          requesterRole,
          jobStatusAtRequest: jobRequest.status,
          reasonCode,
          reasonDetails,
          claimedLiability
        }
      });

      await tx.jobRequest.update({
        where: { id: jobRequestId },
        data: { status: 'TERMINATION_REQUESTED' }
      });

      return terminationRequest;
    });
  }

  @Post(':id/termination-request/accept')
  async acceptTermination(
    @Req() req: any,
    @Param('id') jobRequestId: string
  ) {
    const jobRequest = await this.prisma.jobRequest.findUnique({
      where: { id: jobRequestId },
      include: {
        client: true,
        payment: true,
        proposals: {
          where: { status: 'ACCEPTED' },
          include: {
            specialist: true
          }
        },
        terminationRequest: true
      }
    });

    if (
      !jobRequest ||
      jobRequest.status !== 'TERMINATION_REQUESTED' ||
      !jobRequest.terminationRequest ||
      jobRequest.terminationRequest.status !== 'PENDING'
    ) {
      throw new Error('No existe una terminación pendiente para este trabajo');
    }

    const termination = jobRequest.terminationRequest;
    const acceptedProposal = jobRequest.proposals[0];

    if (!acceptedProposal) {
      throw new Error('No se encontró al especialista contratado');
    }

    if (
      !['AWAITING_PAYMENT', 'ASSIGNED', 'IN_PROGRESS'].includes(
        termination.jobStatusAtRequest
      )
    ) {
      throw new Error(
        'Este tipo de terminación todavía requiere revisión antes de resolverse'
      );
    }

    const isClient = jobRequest.client.userId === req.user.userId;
    const isSpecialist =
      acceptedProposal.specialist.userId === req.user.userId;

    if (termination.requesterRole === 'CLIENT' && !isSpecialist) {
      throw new Error(
        'Solo el especialista contratado puede aceptar esta terminación'
      );
    }

    if (termination.requesterRole === 'SPECIALIST' && !isClient) {
      throw new Error(
        'Solo el cliente puede aceptar esta terminación'
      );
    }

    if (!jobRequest.payment) {
      throw new Error('No se encontró el pago asociado al trabajo');
    }

    const now = new Date();
    const totalAmount = Number(jobRequest.payment.amount);

    if (termination.jobStatusAtRequest === 'AWAITING_PAYMENT') {
      if (jobRequest.payment.status !== 'PENDING') {
        throw new Error('El pago pendiente no se encuentra disponible para cancelar');
      }

      return this.prisma.$transaction(async (tx) => {
        const cancellation = await tx.payment.updateMany({
          where: {
            id: jobRequest.payment!.id,
            status: 'PENDING'
          },
          data: { status: 'CANCELLED' }
        });

        if (cancellation.count !== 1) {
          throw new ConflictException(
            'El pago ya cambió de estado y no puede cancelarse nuevamente'
          );
        }

        await tx.terminationRequest.update({
          where: { id: termination.id },
          data: {
            status: 'RESOLVED',
            liability: 'NONE',
            specialistPayoutAmount: 0,
            clientRefundAmount: 0,
            penaltyAmount: 0,
            resolutionNotes:
              'Terminación aceptada antes del pago. No hubo movimientos económicos.',
            respondedAt: now,
            resolvedAt: now
          }
        });

        const updatedJob = await tx.jobRequest.update({
          where: { id: jobRequestId },
          data: { status: 'CANCELLED' }
        });

        return {
          jobRequest: {
            id: updatedJob.id,
            title: updatedJob.title,
            status: updatedJob.status,
            city: updatedJob.city,
            state: updatedJob.state,
            zipcode: updatedJob.zipcode
          },
          settlement: {
            totalAmount,
            specialistPayout: 0,
            clientRefund: 0,
            penaltyAmount: 0
          }
        };
      });
    }

    if (jobRequest.payment.status !== 'PAID') {
      throw new Error('El pago no está disponible para liquidarse');
    }

    if (termination.jobStatusAtRequest === 'IN_PROGRESS') {
      if (
        !['CLIENT', 'SPECIALIST'].includes(
          termination.claimedLiability
        )
      ) {
        throw new Error(
          'La terminación en progreso requiere atribuir la responsabilidad al cliente o al especialista'
        );
      }

      const liability = termination.claimedLiability;

      const specialistPayout =
        liability === 'CLIENT' ? totalAmount : 0;

      const clientRefund =
        liability === 'SPECIALIST' ? totalAmount : 0;

      return this.prisma.$transaction(async (tx) => {
        const settlement = await tx.payment.updateMany({
          where: {
            id: jobRequest.payment!.id,
            status: 'PAID'
          },
          data: { status: 'SETTLED' }
        });

        if (settlement.count !== 1) {
          throw new ConflictException(
            'El pago ya fue liquidado o cambió de estado'
          );
        }

        await tx.paymentMovement.create({
          data: {
            paymentId: jobRequest.payment!.id,
            type:
              liability === 'CLIENT'
                ? 'SPECIALIST_PAYOUT'
                : 'CLIENT_REFUND',
            amount:
              liability === 'CLIENT'
                ? specialistPayout
                : clientRefund,
            currency: jobRequest.payment!.currency,
            description:
              liability === 'CLIENT'
                ? 'Pago total al especialista por terminación de trabajo en progreso atribuible al cliente'
                : 'Devolución total al cliente por terminación de trabajo en progreso atribuible al especialista'
          }
        });



        await tx.terminationRequest.update({
          where: { id: termination.id },
          data: {
            status: 'RESOLVED',
            liability,
            specialistPayoutAmount: specialistPayout,
            clientRefundAmount: clientRefund,
            penaltyAmount: 0,
            resolutionNotes:
              liability === 'CLIENT'
                ? 'Responsabilidad del cliente aceptada. El especialista recibe el 100% del precio acordado.'
                : 'Responsabilidad del especialista aceptada. El cliente recibe el reembolso del 100% del precio. Daños adicionales o indemnización se evaluarán por separado.',
            respondedAt: now,
            resolvedAt: now
          }
        });

        const updatedJob = await tx.jobRequest.update({
          where: { id: jobRequestId },
          data: { status: 'CANCELLED' }
        });

        return {
          jobRequest: {
            id: updatedJob.id,
            title: updatedJob.title,
            status: updatedJob.status,
            city: updatedJob.city,
            state: updatedJob.state,
            zipcode: updatedJob.zipcode
          },
          settlement: {
            totalAmount,
            specialistPayout,
            clientRefund,
            penaltyAmount: 0,
            liability
          }
        };
      });
    }

    const specialistPayout =
      termination.requesterRole === 'CLIENT'
        ? Math.round(totalAmount * 0.10 * 100) / 100
        : 0;

    const clientRefund =
      termination.requesterRole === 'CLIENT'
        ? Math.round((totalAmount - specialistPayout) * 100) / 100
        : totalAmount;

    const penaltyAmount =
      termination.requesterRole === 'SPECIALIST'
        ? Math.round(totalAmount * 0.10 * 100) / 100
        : 0;

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.payment.updateMany({
        where: {
          id: jobRequest.payment!.id,
          status: 'PAID'
        },
        data: { status: 'SETTLED' }
      });

      if (settlement.count !== 1) {
        throw new ConflictException(
          'El pago ya fue liquidado o cambió de estado'
        );
      }

      const movements =
        termination.requesterRole === 'CLIENT'
          ? [
              {
                paymentId: jobRequest.payment!.id,
                type: 'SPECIALIST_PAYOUT' as const,
                amount: specialistPayout,
                currency: jobRequest.payment!.currency,
                description:
                  'Compensación del 10% por terminación solicitada por el cliente antes de iniciar'
              },
              {
                paymentId: jobRequest.payment!.id,
                type: 'CLIENT_REFUND' as const,
                amount: clientRefund,
                currency: jobRequest.payment!.currency,
                description:
                  'Devolución al cliente por terminación antes de iniciar el trabajo'
              }
            ]
          : [
              {
                paymentId: jobRequest.payment!.id,
                type: 'CLIENT_REFUND' as const,
                amount: clientRefund,
                currency: jobRequest.payment!.currency,
                description:
                  'Devolución total al cliente por terminación solicitada por el especialista'
              },
              {
                paymentId: jobRequest.payment!.id,
                type: 'PENALTY' as const,
                amount: penaltyAmount,
                currency: jobRequest.payment!.currency,
                description:
                  'Penalización del 10% a cargo del especialista; registro interno MVP'
              }
            ];

      await tx.paymentMovement.createMany({
        data: movements
      });



      await tx.terminationRequest.update({
        where: { id: termination.id },
        data: {
          status: 'RESOLVED',
          liability:
            termination.requesterRole === 'CLIENT' ? 'CLIENT' : 'SPECIALIST',
          specialistPayoutAmount: specialistPayout,
          clientRefundAmount: clientRefund,
          penaltyAmount,
          resolutionNotes:
            termination.requesterRole === 'CLIENT'
              ? 'Terminación solicitada por el cliente y aceptada por el especialista antes de iniciar. Se aplica compensación del 10%.'
              : 'Terminación solicitada por el especialista y aceptada por el cliente antes de iniciar. Se devuelve el 100% al cliente y se registra penalización del 10% al especialista.',
          respondedAt: now,
          resolvedAt: now
        }
      });

      const updatedJob = await tx.jobRequest.update({
        where: { id: jobRequestId },
        data: { status: 'CANCELLED' }
      });

      return {
        jobRequest: {
          id: updatedJob.id,
          title: updatedJob.title,
          status: updatedJob.status,
          city: updatedJob.city,
          state: updatedJob.state,
          zipcode: updatedJob.zipcode
        },
        settlement: {
          totalAmount,
          specialistPayout,
          clientRefund,
          penaltyAmount
        }
      };
    });
  }

  @Post(':id/termination-request/dispute')
  async disputeTermination(
    @Req() req: any,
    @Param('id') jobRequestId: string,
    @Body() body: any
  ) {
    const disputeNotes = body.reasonDetails
      ? String(body.reasonDetails).trim()
      : null;

    const jobRequest = await this.prisma.jobRequest.findUnique({
      where: { id: jobRequestId },
      include: {
        client: true,
        proposals: {
          where: { status: 'ACCEPTED' },
          include: {
            specialist: true
          }
        },
        terminationRequest: true
      }
    });

    if (
      !jobRequest ||
      jobRequest.status !== 'TERMINATION_REQUESTED' ||
      !jobRequest.terminationRequest ||
      jobRequest.terminationRequest.status !== 'PENDING'
    ) {
      throw new Error('No existe una terminación pendiente para este trabajo');
    }

    const termination = jobRequest.terminationRequest;
    const acceptedProposal = jobRequest.proposals[0];

    if (!acceptedProposal) {
      throw new Error('No se encontró al especialista contratado');
    }

    const isClient = jobRequest.client.userId === req.user.userId;
    const isSpecialist =
      acceptedProposal.specialist.userId === req.user.userId;

    if (termination.requesterRole === 'CLIENT' && !isSpecialist) {
      throw new Error(
        'Solo el especialista contratado puede disputar esta terminación'
      );
    }

    if (termination.requesterRole === 'SPECIALIST' && !isClient) {
      throw new Error(
        'Solo el cliente puede disputar esta terminación'
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedTermination = await tx.terminationRequest.update({
        where: { id: termination.id },
        data: {
          status: 'DISPUTED',
          disputeNotes,
          resolutionNotes: null,
          respondedAt: new Date()
        }
      });

      await tx.jobRequest.update({
        where: { id: jobRequestId },
        data: { status: 'DISPUTED' }
      });

      return updatedTermination;
    });
  }

  @Get('admin/termination-requests')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getAdminTerminationRequests() {
    const terminations = await this.prisma.terminationRequest.findMany({
      where: {
        status: {
          in: ['DISPUTED', 'RESOLVED']
        }
      },
      include: {
        requestedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
        jobRequest: {
          include: {
            client: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true
                  }
                }
              }
            },
            payment: true,
            proposals: {
              where: {
                status: 'ACCEPTED'
              },
              take: 1,
              include: {
                specialist: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        email: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    return terminations.map((termination) => {
      const jobRequest = termination.jobRequest;
      const acceptedProposal = jobRequest.proposals[0];

      return {
        id: termination.id,
        requesterRole: termination.requesterRole,
        jobStatusAtRequest: termination.jobStatusAtRequest,
        reasonCode: termination.reasonCode,
        reasonDetails: termination.reasonDetails,
        status: termination.status,
        claimedLiability: termination.claimedLiability,
        liability: termination.liability,

        specialistPayoutAmount:
          termination.specialistPayoutAmount !== null
            ? Number(termination.specialistPayoutAmount)
            : null,

        clientRefundAmount:
          termination.clientRefundAmount !== null
            ? Number(termination.clientRefundAmount)
            : null,

        penaltyAmount:
          termination.penaltyAmount !== null
            ? Number(termination.penaltyAmount)
            : null,

        disputeNotes: termination.disputeNotes,
        resolutionNotes: termination.resolutionNotes,
        respondedAt: termination.respondedAt,
        resolvedAt: termination.resolvedAt,
        createdAt: termination.createdAt,

        requestedBy: termination.requestedBy,

        jobRequest: {
          id: jobRequest.id,
          title: jobRequest.title,
          status: jobRequest.status,
          city: jobRequest.city,
          state: jobRequest.state,

          client: {
            id: jobRequest.client.id,
            name: jobRequest.client.user.name,
            email: jobRequest.client.user.email
          },

          specialist: acceptedProposal
            ? {
                id: acceptedProposal.specialist.id,
                name: acceptedProposal.specialist.user.name,
                email: acceptedProposal.specialist.user.email
              }
            : null,

          payment: jobRequest.payment
            ? {
                id: jobRequest.payment.id,
                amount: Number(jobRequest.payment.amount),
                currency: jobRequest.payment.currency,
                status: jobRequest.payment.status
              }
            : null
        }
      };
    });
  }

  @Post(':id/termination-request/resolve')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async resolveTerminationByAdmin(
    @Param('id') jobRequestId: string,
    @Body() body: any
  ) {
    const jobRequest = await this.prisma.jobRequest.findUnique({
      where: { id: jobRequestId },
      include: {
        payment: true,
        terminationRequest: true
      }
    });

    if (
      !jobRequest ||
      !jobRequest.terminationRequest ||
      jobRequest.status !== 'DISPUTED' ||
      jobRequest.terminationRequest.status !== 'DISPUTED'
    ) {
      throw new Error(
        'No existe una terminación disputada pendiente de resolución'
      );
    }

    const termination = jobRequest.terminationRequest;

    const liability = String(
      body.liability || ''
    ).trim().toUpperCase();

    if (!['CLIENT', 'SPECIALIST', 'NONE'].includes(liability)) {
      throw new Error(
        'Debes indicar la responsabilidad final: CLIENT, SPECIALIST o NONE'
      );
    }

    const resolutionNotes = String(
      body.resolutionNotes || ''
    ).trim();

    if (!resolutionNotes) {
      throw new Error('Debes indicar las notas de resolución');
    }

    if (!jobRequest.payment) {
      throw new Error('No se encontró el pago asociado al trabajo');
    }

    const totalAmount =
      Math.round(Number(jobRequest.payment.amount) * 100) / 100;

    /*
     * Si la terminación ocurrió antes del pago:
     * no existen fondos que repartir.
     */
    if (termination.jobStatusAtRequest === 'AWAITING_PAYMENT') {
      if (jobRequest.payment.status !== 'PENDING') {
        throw new Error(
          'El pago pendiente no se encuentra disponible para cancelar'
        );
      }

      return this.prisma.$transaction(async (tx) => {
        const now = new Date();

        const cancellation = await tx.payment.updateMany({
          where: {
            id: jobRequest.payment!.id,
            status: 'PENDING'
          },
          data: { status: 'CANCELLED' }
        });

        if (cancellation.count !== 1) {
          throw new ConflictException(
            'El pago ya cambió de estado y no puede cancelarse nuevamente'
          );
        }

        const updatedTermination =
          await tx.terminationRequest.update({
            where: { id: termination.id },
            data: {
              status: 'RESOLVED',
              liability: liability as 'CLIENT' | 'SPECIALIST' | 'NONE',
              specialistPayoutAmount: 0,
              clientRefundAmount: 0,
              penaltyAmount: 0,
              resolutionNotes,
              resolvedAt: now
            }
          });

        await tx.jobRequest.update({
          where: { id: jobRequestId },
          data: { status: 'CANCELLED' }
        });

        return {
          terminationRequest: updatedTermination,
          settlement: {
            totalAmount,
            specialistPayout: 0,
            clientRefund: 0,
            penaltyAmount: 0
          }
        };
      });
    }

    if (jobRequest.payment.status !== 'PAID') {
      throw new Error(
        'El pago no está disponible para una liquidación administrativa'
      );
    }

    const specialistPayout =
      Math.round(Number(body.specialistPayoutAmount) * 100) / 100;

    const clientRefund =
      Math.round(Number(body.clientRefundAmount) * 100) / 100;

    const penaltyAmount =
      Math.round(Number(body.penaltyAmount || 0) * 100) / 100;

    if (
      !Number.isFinite(specialistPayout) ||
      specialistPayout < 0
    ) {
      throw new Error(
        'El pago al especialista debe ser un monto válido'
      );
    }

    if (
      !Number.isFinite(clientRefund) ||
      clientRefund < 0
    ) {
      throw new Error(
        'El reembolso al cliente debe ser un monto válido'
      );
    }

    if (
      !Number.isFinite(penaltyAmount) ||
      penaltyAmount < 0
    ) {
      throw new Error(
        'La penalización debe ser un monto válido'
      );
    }

    const distributedAmount =
      Math.round((specialistPayout + clientRefund) * 100) / 100;

    if (Math.abs(distributedAmount - totalAmount) > 0.009) {
      throw new Error(
        `El pago al especialista más el reembolso al cliente debe sumar exactamente $${totalAmount.toFixed(2)}`
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const settlement = await tx.payment.updateMany({
        where: {
          id: jobRequest.payment!.id,
          status: 'PAID'
        },
        data: { status: 'SETTLED' }
      });

      if (settlement.count !== 1) {
        throw new ConflictException(
          'El pago ya fue liquidado o cambió de estado'
        );
      }

      if (specialistPayout > 0) {
        await tx.paymentMovement.create({
          data: {
            paymentId: jobRequest.payment!.id,
            type: 'SPECIALIST_PAYOUT',
            amount: specialistPayout,
            currency: jobRequest.payment!.currency,
            description:
              'Pago al especialista determinado por resolución administrativa de terminación disputada'
          }
        });
      }

      if (clientRefund > 0) {
        await tx.paymentMovement.create({
          data: {
            paymentId: jobRequest.payment!.id,
            type: 'CLIENT_REFUND',
            amount: clientRefund,
            currency: jobRequest.payment!.currency,
            description:
              'Reembolso al cliente determinado por resolución administrativa de terminación disputada'
          }
        });
      }

      if (penaltyAmount > 0) {
        await tx.paymentMovement.create({
          data: {
            paymentId: jobRequest.payment!.id,
            type: 'PENALTY',
            amount: penaltyAmount,
            currency: jobRequest.payment!.currency,
            description:
              'Penalización determinada por resolución administrativa de terminación disputada'
          }
        });
      }



      const updatedTermination =
        await tx.terminationRequest.update({
          where: { id: termination.id },
          data: {
            status: 'RESOLVED',
            liability: liability as 'CLIENT' | 'SPECIALIST' | 'NONE',
            specialistPayoutAmount: specialistPayout,
            clientRefundAmount: clientRefund,
            penaltyAmount,
            resolutionNotes,
            resolvedAt: now
          }
        });

      await tx.jobRequest.update({
        where: { id: jobRequestId },
        data: { status: 'CANCELLED' }
      });

      return {
        terminationRequest: updatedTermination,
        settlement: {
          totalAmount,
          specialistPayout,
          clientRefund,
          penaltyAmount,
          liability
        }
      };
    });
  }

  @Post(':id/damage-claims')
  async createDamageClaim(
    @Req() req: any,
    @Param('id') jobRequestId: string,
    @Body() body: any
  ) {
    const type = String(body.type || '').trim().toUpperCase();
    const description = String(body.description || '').trim();

    if (!['RESTITUTION', 'COMPENSATION', 'BOTH'].includes(type)) {
      throw new Error(
        'El tipo de reclamación debe ser RESTITUTION, COMPENSATION o BOTH'
      );
    }

    if (!description) {
      throw new Error('Debes describir el daño o la restitución solicitada');
    }

    let claimedAmount: number | null = null;

    if (body.claimedAmount !== undefined && body.claimedAmount !== null) {
      claimedAmount = Number(body.claimedAmount);

      if (!Number.isFinite(claimedAmount) || claimedAmount <= 0) {
        throw new Error('El monto reclamado debe ser mayor que cero');
      }

      claimedAmount = Math.round(claimedAmount * 100) / 100;
    }

    if (
      ['COMPENSATION', 'BOTH'].includes(type) &&
      claimedAmount === null
    ) {
      throw new Error(
        'Debes indicar el monto reclamado cuando solicitas indemnización'
      );
    }

    const jobRequest = await this.prisma.jobRequest.findUnique({
      where: { id: jobRequestId },
      include: {
        client: true,
        proposals: {
          where: { status: 'ACCEPTED' },
          include: {
            specialist: true
          }
        },
        terminationRequest: true
      }
    });

    if (!jobRequest || !jobRequest.terminationRequest) {
      throw new Error(
        'No existe una terminación asociada a este trabajo'
      );
    }

    const termination = jobRequest.terminationRequest;

    if (termination.jobStatusAtRequest !== 'IN_PROGRESS') {
      throw new Error(
        'Las reclamaciones de daños de este flujo solo aplican a trabajos que ya habían iniciado'
      );
    }

    if (!['RESOLVED', 'DISPUTED'].includes(termination.status)) {
      throw new Error(
        'La terminación debe estar resuelta o en disputa antes de registrar daños'
      );
    }

    const acceptedProposal = jobRequest.proposals[0];

    if (!acceptedProposal) {
      throw new Error('No se encontró al especialista contratado');
    }

    const isClient = jobRequest.client.userId === req.user.userId;
    const isSpecialist =
      acceptedProposal.specialist.userId === req.user.userId;

    if (!isClient && !isSpecialist) {
      throw new Error(
        'No tienes autorización para registrar daños en este trabajo'
      );
    }

    const claimedAgainst = isClient ? 'SPECIALIST' : 'CLIENT';

    if (
      termination.status === 'RESOLVED' &&
      termination.liability !== claimedAgainst
    ) {
      throw new Error(
        'La responsabilidad resuelta no corresponde a la parte contra la que se reclama'
      );
    }

    return this.prisma.damageClaim.create({
      data: {
        terminationRequestId: termination.id,
        claimedById: req.user.userId,
        claimedAgainst,
        type: type as 'RESTITUTION' | 'COMPENSATION' | 'BOTH',
        description,
        claimedAmount
      }
    });
  }

  @Post(':id/damage-claims/:claimId/accept')
  async acceptDamageClaim(
    @Req() req: any,
    @Param('id') jobRequestId: string,
    @Param('claimId') claimId: string,
    @Body() body: any
  ) {
    const responseNotes = body.responseNotes
      ? String(body.responseNotes).trim()
      : null;

    const claim = await this.prisma.damageClaim.findUnique({
      where: { id: claimId },
      include: {
        terminationRequest: {
          include: {
            jobRequest: {
              include: {
                client: true,
                proposals: {
                  where: { status: 'ACCEPTED' },
                  include: {
                    specialist: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!claim) {
      throw new Error('La reclamación de daños no existe');
    }

    const jobRequest = claim.terminationRequest.jobRequest;

    if (jobRequest.id !== jobRequestId) {
      throw new Error(
        'La reclamación no corresponde a este trabajo'
      );
    }

    if (claim.status !== 'PENDING') {
      throw new Error(
        'Esta reclamación ya fue respondida'
      );
    }

    const acceptedProposal = jobRequest.proposals[0];

    if (!acceptedProposal) {
      throw new Error('No se encontró al especialista contratado');
    }

    const isClient =
      jobRequest.client.userId === req.user.userId;

    const isSpecialist =
      acceptedProposal.specialist.userId === req.user.userId;

    if (
      claim.claimedAgainst === 'CLIENT' &&
      !isClient
    ) {
      throw new Error(
        'Solo el cliente reclamado puede aceptar esta reclamación'
      );
    }

    if (
      claim.claimedAgainst === 'SPECIALIST' &&
      !isSpecialist
    ) {
      throw new Error(
        'Solo el especialista reclamado puede aceptar esta reclamación'
      );
    }

    return this.prisma.damageClaim.update({
      where: { id: claim.id },
      data: {
        status: 'ACCEPTED',
        approvedAmount: claim.claimedAmount,
        resolutionNotes:
          responseNotes || 'Reclamación aceptada por la parte responsable'
      }
    });
  }

  @Post(':id/damage-claims/:claimId/dispute')
  async disputeDamageClaim(
    @Req() req: any,
    @Param('id') jobRequestId: string,
    @Param('claimId') claimId: string,
    @Body() body: any
  ) {
    const responseNotes = String(
      body.responseNotes || ''
    ).trim();

    if (!responseNotes) {
      throw new Error(
        'Debes indicar por qué disputas la reclamación'
      );
    }

    const claim = await this.prisma.damageClaim.findUnique({
      where: { id: claimId },
      include: {
        terminationRequest: {
          include: {
            jobRequest: {
              include: {
                client: true,
                proposals: {
                  where: { status: 'ACCEPTED' },
                  include: {
                    specialist: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!claim) {
      throw new Error('La reclamación de daños no existe');
    }

    const jobRequest = claim.terminationRequest.jobRequest;

    if (jobRequest.id !== jobRequestId) {
      throw new Error(
        'La reclamación no corresponde a este trabajo'
      );
    }

    if (claim.status !== 'PENDING') {
      throw new Error(
        'Esta reclamación ya fue respondida'
      );
    }

    const acceptedProposal = jobRequest.proposals[0];

    if (!acceptedProposal) {
      throw new Error('No se encontró al especialista contratado');
    }

    const isClient =
      jobRequest.client.userId === req.user.userId;

    const isSpecialist =
      acceptedProposal.specialist.userId === req.user.userId;

    if (
      claim.claimedAgainst === 'CLIENT' &&
      !isClient
    ) {
      throw new Error(
        'Solo el cliente reclamado puede disputar esta reclamación'
      );
    }

    if (
      claim.claimedAgainst === 'SPECIALIST' &&
      !isSpecialist
    ) {
      throw new Error(
        'Solo el especialista reclamado puede disputar esta reclamación'
      );
    }

    return this.prisma.damageClaim.update({
      where: { id: claim.id },
      data: {
        status: 'DISPUTED',
        approvedAmount: null,
        resolutionNotes: responseNotes
      }
    });
  }

  @Get('admin/completion-claims')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getAdminCompletionClaims() {
    const claims = await this.prisma.completionClaim.findMany({
      select: {
        id: true,
        jobRequestId: true,
        description: true,
        status: true,
        specialistResponseNotes: true,
        specialistRespondedAt: true,
        resolutionNotes: true,
        resolvedAt: true,
        createdAt: true,
        updatedAt: true,
        jobRequest: {
          select: {
            id: true,
            title: true,
            status: true,
            city: true,
            state: true,
            client: {
              select: {
                user: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              }
            },
            proposals: {
              where: { status: 'ACCEPTED' },
              take: 1,
              select: {
                specialist: {
                  select: {
                    user: {
                      select: {
                        id: true,
                        name: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return claims.map(claim => ({
      id: claim.id,
      jobRequestId: claim.jobRequestId,
      description: claim.description,
      status: claim.status,
      specialistResponseNotes: claim.specialistResponseNotes,
      specialistRespondedAt: claim.specialistRespondedAt,
      resolutionNotes: claim.resolutionNotes,
      resolvedAt: claim.resolvedAt,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
      jobRequest: {
        id: claim.jobRequest.id,
        title: claim.jobRequest.title,
        status: claim.jobRequest.status,
        city: claim.jobRequest.city,
        state: claim.jobRequest.state,
        client: claim.jobRequest.client.user,
        specialist:
          claim.jobRequest.proposals[0]?.specialist.user ?? null
      }
    }));
  }

  @Post(':id/completion-claims/:claimId/resolve')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async resolveCompletionClaimByAdmin(
    @Param('id') jobRequestId: string,
    @Param('claimId') claimId: string,
    @Body() body: any
  ) {
    const decision = String(body?.decision ?? '').trim().toUpperCase();
    const notes = String(body?.resolutionNotes ?? '').trim();

    if (!['RESOLVED', 'REJECTED'].includes(decision)) {
      throw new BadRequestException(
        'La decisión debe ser RESOLVED o REJECTED'
      );
    }

    if (notes.length < 10 || notes.length > 4000) {
      throw new BadRequestException(
        'La justificación debe contener entre 10 y 4000 caracteres'
      );
    }

    return this.retryTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        const lockedJobs = await tx.$queryRaw`
          SELECT "id"
          FROM "JobRequest"
          WHERE "id" = ${jobRequestId}
          FOR UPDATE
        `;

        if (!Array.isArray(lockedJobs) || lockedJobs.length !== 1) {
          throw new NotFoundException(
            'El trabajo no existe'
          );
        }

        const claim = await tx.completionClaim.findFirst({
          where: {
            id: claimId,
            jobRequestId,
            status: {
              in: ['DISPUTED', 'CORRECTION_REQUESTED']
            }
          },
          select: { id: true }
        });

        if (!claim) {
          throw new ConflictException(
            'La reclamación no existe o no está disponible para resolución'
          );
        }

        const updated = await tx.completionClaim.updateMany({
          where: {
            id: claimId,
            jobRequestId,
            status: {
              in: ['DISPUTED', 'CORRECTION_REQUESTED']
            }
          },
          data: {
            status: decision as 'RESOLVED' | 'REJECTED',
            resolutionNotes: notes,
            resolvedAt: new Date()
          }
        });

        if (updated.count !== 1) {
          throw new ConflictException(
            'La reclamación cambió antes de registrar la resolución'
          );
        }

        return tx.completionClaim.findUniqueOrThrow({
          where: { id: claimId },
          select: {
            id: true,
            jobRequestId: true,
            status: true,
            resolutionNotes: true,
            resolvedAt: true
          }
        });
      }, { isolationLevel: 'Serializable' })
    );
  }

  @Get('admin/damage-claims')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getAdminDamageClaims() {
    const claims = await this.prisma.damageClaim.findMany({
      where: {
        status: {
          in: ['ACCEPTED', 'DISPUTED', 'RESOLVED', 'REJECTED']
        }
      },
      include: {
        claimedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
        terminationRequest: {
          include: {
            jobRequest: {
              include: {
                client: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        email: true
                      }
                    }
                  }
                },
                proposals: {
                  where: {
                    status: 'ACCEPTED'
                  },
                  take: 1,
                  include: {
                    specialist: {
                      include: {
                        user: {
                          select: {
                            id: true,
                            name: true,
                            email: true
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return claims.map((claim) => {
      const jobRequest = claim.terminationRequest.jobRequest;
      const acceptedProposal = jobRequest.proposals[0];

      return {
        id: claim.id,
        type: claim.type,
        description: claim.description,
        claimedAmount:
          claim.claimedAmount !== null
            ? Number(claim.claimedAmount)
            : null,
        approvedAmount:
          claim.approvedAmount !== null
            ? Number(claim.approvedAmount)
            : null,
        status: claim.status,
        claimedAgainst: claim.claimedAgainst,
        coverageSource: claim.coverageSource,
        insuranceReference: claim.insuranceReference,
        resolutionNotes: claim.resolutionNotes,
        createdAt: claim.createdAt,
        resolvedAt: claim.resolvedAt,
        claimedBy: claim.claimedBy,
        jobRequest: {
          id: jobRequest.id,
          title: jobRequest.title,
          status: jobRequest.status,
          city: jobRequest.city,
          state: jobRequest.state,
          client: {
            id: jobRequest.client.id,
            name: jobRequest.client.user.name,
            email: jobRequest.client.user.email
          },
          specialist: acceptedProposal
            ? {
                id: acceptedProposal.specialist.id,
                name: acceptedProposal.specialist.user.name,
                email: acceptedProposal.specialist.user.email
              }
            : null
        }
      };
    });
  }

  @Post(':id/damage-claims/:claimId/resolve')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async resolveDamageClaim(
    @Param('id') jobRequestId: string,
    @Param('claimId') claimId: string,
    @Body() body: any
  ) {
    const claim = await this.prisma.damageClaim.findUnique({
      where: { id: claimId },
      include: {
        terminationRequest: {
          include: { jobRequest: true }
        }
      }
    });

    if (!claim) throw new Error('La reclamación no existe');

    if (claim.terminationRequest.jobRequest.id !== jobRequestId) {
      throw new Error('La reclamación no corresponde a este trabajo');
    }

    if (!['ACCEPTED', 'DISPUTED'].includes(claim.status)) {
      throw new Error('La reclamación no está lista para resolución');
    }

    const decision = String(body.decision || '').toUpperCase();
    const notes = String(body.resolutionNotes || '').trim();

    if (!notes) throw new Error('Debes indicar las notas de resolución');

    if (decision === 'REJECTED') {
      return this.prisma.damageClaim.update({
        where: { id: claim.id },
        data: {
          status: 'REJECTED',
          approvedAmount: null,
          coverageSource: 'UNDETERMINED',
          insuranceReference: null,
          resolutionNotes: notes,
          resolvedAt: new Date()
        }
      });
    }

    if (decision !== 'RESOLVED') {
      throw new Error('La decisión debe ser RESOLVED o REJECTED');
    }

    const amount =
      body.approvedAmount !== undefined
        ? Number(body.approvedAmount)
        : claim.approvedAmount !== null
          ? Number(claim.approvedAmount)
          : null;

    if (
      ['COMPENSATION', 'BOTH'].includes(claim.type) &&
      (!amount || amount <= 0)
    ) {
      throw new Error('Debes indicar un monto aprobado mayor que cero');
    }

    const coverage = String(body.coverageSource || '').toUpperCase();

    if (
      !['RESPONSIBLE_PARTY', 'PLATFORM_INSURANCE', 'PLATFORM'].includes(coverage)
    ) {
      throw new Error('Fuente de cobertura no válida');
    }

    const insuranceReference = body.insuranceReference
      ? String(body.insuranceReference).trim()
      : null;

    if (coverage === 'PLATFORM_INSURANCE' && !insuranceReference) {
      throw new Error('Debes indicar la referencia del seguro');
    }

    return this.prisma.damageClaim.update({
      where: { id: claim.id },
      data: {
        status: 'RESOLVED',
        approvedAmount: amount,
        coverageSource: coverage as
          | 'RESPONSIBLE_PARTY'
          | 'PLATFORM_INSURANCE'
          | 'PLATFORM',
        insuranceReference,
        resolutionNotes: notes,
        resolvedAt: new Date()
      }
    });
  }

  @Get('messages/conversations')
  async getMessageConversations(@Req() req: any) {
    const jobs = await this.prisma.jobRequest.findMany({
      where: {
        messages: {
          some: {}
        },
        OR: [
          {
            client: {
              userId: req.user.userId
            }
          },
          {
            proposals: {
              some: {
                status: 'ACCEPTED',
                specialist: {
                  userId: req.user.userId
                }
              }
            }
          }
        ]
      },
      include: {
        client: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                role: true
              }
            }
          }
        },
        proposals: {
          where: {
            status: 'ACCEPTED'
          },
          take: 1,
          include: {
            specialist: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    role: true
                  }
                }
              }
            }
          }
        },
        messages: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 1,
          include: {
            sender: {
              select: {
                id: true,
                name: true,
                role: true
              }
            }
          }
        }
      }
    });

    const jobIds = jobs.map((job) => job.id);

    const unreadMessages = jobIds.length
      ? await this.prisma.message.findMany({
          where: {
            jobRequestId: {
              in: jobIds
            },
            senderId: {
              not: req.user.userId
            },
            readAt: null
          },
          select: {
            jobRequestId: true
          }
        })
      : [];

    const unreadCounts: Record<string, number> = {};

    for (const message of unreadMessages) {
      unreadCounts[message.jobRequestId] =
        (unreadCounts[message.jobRequestId] || 0) + 1;
    }

    return jobs
      .map((job) => {
        const specialistUser =
          job.proposals[0]?.specialist?.user || null;

        const otherUser =
          job.client.user.id === req.user.userId
            ? specialistUser
            : job.client.user;

        return {
          jobRequestId: job.id,
          jobTitle: job.title,
          jobStatus: job.status,
          otherUser,
          lastMessage: job.messages[0] || null,
          unreadCount: unreadCounts[job.id] || 0
        };
      })
      .sort((a, b) => {
        const dateA = a.lastMessage?.createdAt
          ? new Date(a.lastMessage.createdAt).getTime()
          : 0;
        const dateB = b.lastMessage?.createdAt
          ? new Date(b.lastMessage.createdAt).getTime()
          : 0;

        return dateB - dateA;
      });
  }

  @Get('messages/unread-counts')
  async getUnreadMessageCounts(@Req() req: any) {
    const messages = await this.prisma.message.findMany({
      where: {
        senderId: { not: req.user.userId },
        readAt: null,
        jobRequest: {
          OR: [
            {
              client: {
                userId: req.user.userId
              }
            },
            {
              proposals: {
                some: {
                  status: 'ACCEPTED',
                  specialist: {
                    userId: req.user.userId
                  }
                }
              }
            }
          ]
        }
      },
      select: {
        jobRequestId: true
      }
    });

    const counts: Record<string, number> = {};

    for (const message of messages) {
      counts[message.jobRequestId] =
        (counts[message.jobRequestId] || 0) + 1;
    }

    return counts;
  }

  @Get(':id/messages')
  async getJobMessages(
    @Req() req: any,
    @Param('id') jobRequestId: string
  ) {
    const job = await this.prisma.jobRequest.findFirst({
      where: {
        id: jobRequestId,
        proposals: {
          some: { status: 'ACCEPTED' }
        }
      },
      include: {
        client: {
          select: { userId: true }
        },
        proposals: {
          where: { status: 'ACCEPTED' },
          take: 1,
          include: {
            specialist: {
              select: { userId: true }
            }
          }
        }
      }
    });

    if (!job) {
      throw new NotFoundException('El trabajo no existe o aún no tiene especialista contratado');
    }

    const specialistUserId = job.proposals[0]?.specialist?.userId;

    const isParticipant =
      req.user.userId === job.client.userId ||
      req.user.userId === specialistUserId;

    if (!isParticipant) {
      throw new ForbiddenException('No tienes acceso a esta conversación');
    }

    await this.prisma.message.updateMany({
      where: {
        jobRequestId,
        senderId: { not: req.user.userId },
        readAt: null
      },
      data: {
        readAt: new Date()
      }
    });

    return this.prisma.message.findMany({
      where: { jobRequestId },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            role: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });
  }

  @Post(':id/messages')
  async sendJobMessage(
    @Req() req: any,
    @Param('id') jobRequestId: string,
    @Body() body: any
  ) {
    const messageBody = String(body.body || '').trim();

    if (!messageBody) {
      throw new BadRequestException('El mensaje no puede estar vacío');
    }

    if (messageBody.length > 2000) {
      throw new BadRequestException('El mensaje no puede exceder 2000 caracteres');
    }

    const job = await this.prisma.jobRequest.findFirst({
      where: {
        id: jobRequestId,
        proposals: {
          some: { status: 'ACCEPTED' }
        }
      },
      include: {
        client: {
          select: { userId: true }
        },
        proposals: {
          where: { status: 'ACCEPTED' },
          take: 1,
          select: {
            id: true,
            specialist: {
              select: {
                id: true,
                userId: true
              }
            }
          }
        }
      }
    });

    if (!job) {
      throw new NotFoundException('El trabajo no existe o aún no tiene especialista contratado');
    }

    const specialistUserId = job.proposals[0]?.specialist?.userId;

    const isParticipant =
      req.user.userId === job.client.userId ||
      req.user.userId === specialistUserId;

    if (!isParticipant) {
      throw new ForbiddenException('No tienes acceso a esta conversación');
    }

    if (containsLikelyStreetAddress(messageBody)) {
      const payment = await this.prisma.payment.findUnique({
        where: { jobRequestId },
        select: {
          status: true,
          specialistId: true,
          proposalId: true
        }
      });

      const acceptedProposal = job.proposals[0];
      const acceptedSpecialistId =
        acceptedProposal?.specialist?.id;

      if (
        !payment ||
        !['PAID', 'RELEASED'].includes(payment.status) ||
        !acceptedSpecialistId ||
        payment.specialistId !== acceptedSpecialistId ||
        payment.proposalId !== acceptedProposal?.id
      ) {
        throw new BadRequestException(
          'Por privacidad, la dirección exacta del servicio ' +
          'no puede compartirse por mensaje antes de confirmar ' +
          'el pago. Utiliza el sistema de dirección privada ' +
          'de ConnectPro.'
        );
      }
    }

    return this.prisma.message.create({
      data: {
        jobRequestId,
        senderId: req.user.userId,
        body: messageBody
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            role: true
          }
        }
      }
    });
  }

  @Get(':id/service-address')
  async getServiceAddress(
    @Req() req: any,
    @Param('id') jobRequestId: string
  ) {
    const job = await this.prisma.jobRequest.findUnique({
      where: { id: jobRequestId },
      select: {
        client: {
          select: { userId: true }
        },
        serviceAddress: true,
        city: true,
        state: true,
        zipcode: true,
        status: true,
        proposals: {
          where: { status: 'ACCEPTED' },
          select: {
            id: true,
            specialistId: true,
            specialist: {
              select: { userId: true }
            }
          }
        },
        payment: {
          select: {
            status: true,
            specialistId: true,
            proposalId: true
          }
        }
      }
    });

    if (!job) {
      throw new ForbiddenException(
        'No tienes autorización para consultar esta dirección'
      );
    }

    const userId = req.user.userId;
    const isOwner = job.client.userId === userId;

    const isContractedSpecialist =
      job.proposals.some(
        proposal =>
          proposal.specialist.userId === userId &&
          job.payment?.specialistId === proposal.specialistId &&
          job.payment?.proposalId === proposal.id
      );

    const allowedStatuses = [
      'ASSIGNED',
      'IN_PROGRESS',
      'AWAITING_CLIENT_CONFIRMATION',
      'TERMINATION_REQUESTED',
      'DISPUTED',
      'COMPLETED'
    ];

    const paid =
      job.payment?.status === 'PAID' ||
      job.payment?.status === 'RELEASED';

    const specialistAuthorized =
      isContractedSpecialist &&
      allowedStatuses.includes(job.status) &&
      paid;

    if (!isOwner && !specialistAuthorized) {
      throw new ForbiddenException(
        'No tienes autorización para consultar esta dirección'
      );
    }

    return {
      serviceAddress: job.serviceAddress,
      city: job.city,
      state: job.state,
      zipcode: job.zipcode
    };
  }

  @Get('me')
  async myRequests(@Req() req: any) {
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      return [];
    }

    const jobs = await this.prisma.jobRequest.findMany({
      where: { clientId: client.id },
      include: {
        category: true,
        review: true,
        terminationRequest: {
          include: {
            damageClaims: true
          }
        },
        proposals: {
          where: {
            status: 'ACCEPTED'
          },
          select: {
            id: true,
            amount: true,
            specialist: {
              select: {
                id: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return jobs.map(job => {
      const {
        latitude,
        longitude,
        locationVerifiedAt,
        ...clientJob
      } = job;

      return clientJob;
    });
  }
}
