import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('job-requests')
@UseGuards(JwtAuthGuard)
export class JobRequestsController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      throw new Error('El usuario no tiene perfil de cliente');
    }

    return this.prisma.jobRequest.create({
      data: {
        clientId: client.id,
        categoryId: body.categoryId,
        title: body.title,
        description: body.description,
        budgetMin:
          body.budgetMin !== undefined && body.budgetMin !== null
            ? Number(body.budgetMin)
            : null,
        budgetMax:
          body.budgetMax !== undefined && body.budgetMax !== null
            ? Number(body.budgetMax)
            : null,
        city: body.city,
        state: body.state,
        zipcode: body.zipcode || null,
        desiredDate: body.desiredDate
          ? new Date(body.desiredDate)
          : null
      },
      include: {
        category: true
      }
    });
  }

  @Post(':id/proposals')
  async createProposal(
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

    return this.prisma.$transaction(async (tx) => {
      const proposal = await tx.proposal.create({
        data: {
          jobRequestId,
          specialistId: specialist.id,
          amount: Number(body.amount),
          message: body.message || null,
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

    const city = specialist.user?.locations?.[0]?.city;

    return this.prisma.jobRequest.findMany({
      where: {
        status: {
          in: ['PUBLISHED', 'RECEIVING_QUOTES']
        },
        ...(categoryIds.length
          ? { categoryId: { in: categoryIds } }
          : {}),
        ...(city
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

    const proposal = await this.prisma.proposal.findFirst({
      where: {
        id: proposalId,
        jobRequestId,
        status: 'PENDING',
        jobRequest: {
          clientId: client.id,
          status: {
            in: ['PUBLISHED', 'RECEIVING_QUOTES']
          }
        }
      }
    });

    if (!proposal) {
      throw new Error(
        'La propuesta no existe, no te pertenece o ya no puede rechazarse'
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedProposal = await tx.proposal.update({
        where: { id: proposal.id },
        data: { status: 'REJECTED' }
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

    const jobRequest = await this.prisma.jobRequest.findFirst({
      where: {
        id: jobRequestId,
        clientId: client.id
      }
    });

    if (!jobRequest) {
      throw new Error('La solicitud no existe o no pertenece al cliente');
    }

    if (
      !['PUBLISHED', 'RECEIVING_QUOTES'].includes(jobRequest.status)
    ) {
      throw new Error('Este trabajo ya no acepta propuestas');
    }

    const proposal = await this.prisma.proposal.findFirst({
      where: {
        id: proposalId,
        jobRequestId,
        status: 'PENDING'
      }
    });

    if (!proposal) {
      throw new Error('La propuesta no existe');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.proposal.update({
        where: { id: proposalId },
        data: { status: 'ACCEPTED' }
      });

      await tx.proposal.updateMany({
        where: {
          jobRequestId,
          id: { not: proposalId },
          status: 'PENDING'
        },
        data: { status: 'REJECTED' }
      });

      await tx.payment.create({
        data: {
          jobRequestId,
          proposalId,
          clientId: client.id,
          specialistId: proposal.specialistId,
          amount: proposal.amount,
          currency: 'USD',
          status: 'PENDING'
        }
      });

      await tx.jobRequest.update({
        where: { id: jobRequestId },
        data: { status: 'AWAITING_PAYMENT' }
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
    });
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

    return this.prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PAID',
          provider: 'INTERNAL_MVP',
          paidAt: new Date()
        }
      });

      await tx.jobRequest.update({
        where: { id: jobRequestId },
        data: { status: 'ASSIGNED' }
      });

      return updatedPayment;
    });
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
      }
    });

    if (!jobRequest) {
      throw new Error('El trabajo no está asignado a este especialista o no puede iniciarse');
    }

    return this.prisma.jobRequest.update({
      where: { id: jobRequestId },
      data: { status: 'IN_PROGRESS' }
    });
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

    return this.prisma.jobRequest.update({
      where: { id: jobRequestId },
      data: { status: 'AWAITING_CLIENT_CONFIRMATION' }
    });
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

    return this.prisma.jobRequest.findMany({
      where: {
        status: {
          in: ['ASSIGNED', 'IN_PROGRESS', 'AWAITING_CLIENT_CONFIRMATION', 'COMPLETED']
        },
        proposals: {
          some: {
            specialistId: specialist.id,
            status: 'ACCEPTED'
          }
        }
      },
      include: {
        category: true,
        specialistReview: true,
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
            status: 'ACCEPTED'
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
      throw new Error('La solicitud no existe o no pertenece al cliente');
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

    return this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: jobRequest.payment!.id },
        data: {
          status: 'RELEASED',
          releasedAt: new Date()
        }
      });

      return tx.jobRequest.update({
        where: { id: jobRequestId },
        data: { status: 'COMPLETED' }
      });
    });
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

    if (body.budgetMin !== undefined) {
      data.budgetMin =
        body.budgetMin === null || body.budgetMin === ''
          ? null
          : Number(body.budgetMin);
    }

    if (body.budgetMax !== undefined) {
      data.budgetMax =
        body.budgetMax === null || body.budgetMax === ''
          ? null
          : Number(body.budgetMax);
    }

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

    return this.prisma.jobRequest.update({
      where: { id: jobRequest.id },
      data
    });
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

      return tx.jobRequest.update({
        where: { id: jobRequestId },
        data: { status: 'CANCELLED' }
      });
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
        await tx.payment.update({
          where: { id: jobRequest.payment!.id },
          data: { status: 'CANCELLED' }
        });

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
          jobRequest: updatedJob,
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

        await tx.payment.update({
          where: { id: jobRequest.payment!.id },
          data: { status: 'SETTLED' }
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
          jobRequest: updatedJob,
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
      Math.round(totalAmount * 0.10 * 100) / 100;

    return this.prisma.$transaction(async (tx) => {
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

      await tx.payment.update({
        where: { id: jobRequest.payment!.id },
        data: { status: 'SETTLED' }
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
        jobRequest: updatedJob,
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
    const resolutionNotes = body.reasonDetails
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
          resolutionNotes,
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
      throw new Error('El trabajo no existe o aún no tiene especialista contratado');
    }

    const specialistUserId = job.proposals[0]?.specialist?.userId;

    const isParticipant =
      req.user.userId === job.client.userId ||
      req.user.userId === specialistUserId;

    if (!isParticipant) {
      throw new Error('No tienes acceso a esta conversación');
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
      throw new Error('El mensaje no puede estar vacío');
    }

    if (messageBody.length > 2000) {
      throw new Error('El mensaje no puede exceder 2000 caracteres');
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
          include: {
            specialist: {
              select: { userId: true }
            }
          }
        }
      }
    });

    if (!job) {
      throw new Error('El trabajo no existe o aún no tiene especialista contratado');
    }

    const specialistUserId = job.proposals[0]?.specialist?.userId;

    const isParticipant =
      req.user.userId === job.client.userId ||
      req.user.userId === specialistUserId;

    if (!isParticipant) {
      throw new Error('No tienes acceso a esta conversación');
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

  @Get('me')
  async myRequests(@Req() req: any) {
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (!client) {
      return [];
    }

    return this.prisma.jobRequest.findMany({
      where: { clientId: client.id },
      include: {
        category: true,
        review: true,
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
  }
}
