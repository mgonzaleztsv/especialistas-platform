import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
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

    if (jobRequest.status !== 'PUBLISHED') {
      throw new Error('Esta solicitud ya no acepta propuestas');
    }

    return this.prisma.proposal.create({
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
          status: 'PUBLISHED'
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

    return this.prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        ...data,
        status: 'PENDING'
      }
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

    return this.prisma.proposal.update({
      where: { id: proposal.id },
      data: { status: 'WITHDRAWN' }
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
        status: 'PUBLISHED',
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

    if (jobRequest.status !== 'PUBLISHED') {
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
          id: { not: proposalId }
        },
        data: { status: 'REJECTED' }
      });

      await tx.jobRequest.update({
        where: { id: jobRequestId },
        data: { status: 'ASSIGNED' }
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
      data: { status: 'COMPLETED' }
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
          in: ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED']
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
