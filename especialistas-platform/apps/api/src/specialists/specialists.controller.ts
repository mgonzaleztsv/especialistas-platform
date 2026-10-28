import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('specialists')
export class SpecialistsController {
  constructor(private prisma:PrismaService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me/service-areas')
  async getMyServiceAreas(@Req() req: any) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId },
      select: { id: true }
    });

    if (!specialist) {
      throw new ForbiddenException(
        'Necesitas un perfil de especialista para consultar tus zonas de servicio'
      );
    }

    return this.prisma.serviceArea.findMany({
      where: { specialistId: specialist.id },
      orderBy: { createdAt: 'asc' }
    });
  }



  @UseGuards(JwtAuthGuard)
  @Post('me/service-areas')
  async createMyServiceArea(
    @Req() req: any,
    @Body() body: any
  ) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId },
      select: { id: true }
    });

    if (!specialist) {
      throw new ForbiddenException(
        'Necesitas un perfil de especialista'
      );
    }

    const name =
      typeof body?.name === 'string'
        ? body.name.trim()
        : '';

    const latitude = body?.centerLatitude;
    const longitude = body?.centerLongitude;
    const radius = body?.radiusMiles;

    if (!name || name.length > 100) {
      throw new BadRequestException(
        'El nombre debe tener entre 1 y 100 caracteres'
      );
    }

    if (
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90
    ) {
      throw new BadRequestException('Latitud inválida');
    }

    if (
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new BadRequestException('Longitud inválida');
    }

    if (
      !Number.isInteger(radius) ||
      radius < 1 ||
      radius > 100
    ) {
      throw new BadRequestException(
        'El radio debe estar entre 1 y 100 millas'
      );
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.specialist.update({
              where: { id: specialist.id },
              data: { updatedAt: new Date() }
            });

            const count = await tx.serviceArea.count({
              where: { specialistId: specialist.id }
            });

            if (count >= 10) {
              throw new BadRequestException(
                'Puedes registrar hasta 10 zonas de servicio'
              );
            }

            return tx.serviceArea.create({
              data: {
                specialistId: specialist.id,
                name,
                centerLatitude: latitude,
                centerLongitude: longitude,
                radiusMiles: radius,
                isActive: true
              }
            });
          },
          {
            isolationLevel: 'Serializable'
          }
        );
      } catch (error: any) {
        if (error?.code !== 'P2034' || attempt === 3) {
          throw error;
        }
      }
    }

    throw new BadRequestException(
      'No se pudo registrar la zona. Inténtalo nuevamente.'
    );
  }


  @UseGuards(JwtAuthGuard)
  @Patch('me/service-areas/:areaId')
  async updateMyServiceArea(
    @Req() req: any,
    @Param('areaId') areaId: string,
    @Body() body: any
  ) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId },
      select: { id: true }
    });

    if (!specialist) {
      throw new ForbiddenException(
        'Necesitas un perfil de especialista'
      );
    }

    const area = await this.prisma.serviceArea.findFirst({
      where: {
        id: areaId,
        specialistId: specialist.id
      }
    });

    if (!area) {
      throw new NotFoundException(
        'Zona de servicio no encontrada'
      );
    }

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body)
    ) {
      throw new BadRequestException('Datos inválidos');
    }

    const allowed = [
      'name',
      'centerLatitude',
      'centerLongitude',
      'radiusMiles',
      'isActive'
    ];

    const keys = Object.keys(body);

    if (
      keys.length === 0 ||
      keys.some(key => !allowed.includes(key))
    ) {
      throw new BadRequestException(
        'Debes proporcionar campos válidos'
      );
    }

    const data: any = {};

    if ('name' in body) {
      if (typeof body.name !== 'string') {
        throw new BadRequestException('Nombre inválido');
      }
      const name = body.name.trim();
      if (!name || name.length > 100) {
        throw new BadRequestException('Nombre inválido');
      }
      data.name = name;
    }

    for (const [field, min, max] of [
      ['centerLatitude', -90, 90],
      ['centerLongitude', -180, 180]
    ] as const) {
      if (field in body) {
        const value = body[field];
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < min ||
          value > max
        ) {
          throw new BadRequestException(
            'Coordenada inválida: ' + field
          );
        }
        data[field] = value;
      }
    }

    if ('radiusMiles' in body) {
      if (
        !Number.isInteger(body.radiusMiles) ||
        body.radiusMiles < 1 ||
        body.radiusMiles > 100
      ) {
        throw new BadRequestException(
          'El radio debe estar entre 1 y 100 millas'
        );
      }
      data.radiusMiles = body.radiusMiles;
    }

    if ('isActive' in body) {
      if (typeof body.isActive !== 'boolean') {
        throw new BadRequestException(
          'El estado activo debe ser verdadero o falso'
        );
      }
      data.isActive = body.isActive;
    }

    const result = await this.prisma.serviceArea.updateMany({
      where: {
        id: areaId,
        specialistId: specialist.id
      },
      data
    });

    if (result.count !== 1) {
      throw new NotFoundException(
        'Zona de servicio no encontrada'
      );
    }

    return this.prisma.serviceArea.findFirst({
      where: {
        id: areaId,
        specialistId: specialist.id
      }
    });
  }

  private calculateTrustScore(specialist: any): number {
    let score = 0;

    if (specialist.verificationStatus === 'VERIFIED') {
      score += 40;
    }

    if (specialist.reviews?.length) {
      const average =
        specialist.reviews.reduce(
          (sum: number, review: any) => sum + review.rating,
          0
        ) / specialist.reviews.length;

      score += Math.round((average / 5) * 30);
    }

    const hasLocation =
      specialist.user?.locations?.some(
        (location: any) => location.city && location.state
      );

    const profileComplete =
      Boolean(specialist.description?.trim()) &&
      Number(specialist.experienceYears) > 0 &&
      specialist.hourlyRate !== null &&
      specialist.hourlyRate !== undefined &&
      Boolean(specialist.categories?.length) &&
      Boolean(hasLocation);

    if (profileComplete) {
      score += 20;
    }

    if (specialist.portfolioItems?.length) {
      score += 10;
    }

    return Math.min(100, Math.max(0, score));
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async list(
    @Req() req: any,
    @Query('category') category?: string,
    @Query('city') city?: string
  ) {
    const client = await this.prisma.client.findUnique({
      where: { userId: req.user.userId },
      select: { id: true, status: true }
    });

    if (!client || client.status !== 'ACTIVE') {
      throw new ForbiddenException(
        'Para consultar el directorio necesitas completar y activar tu perfil de contratación.'
      );
    }

    const specialists = await this.prisma.specialist.findMany({
      where: {
        categories: category
          ? { some: { category: { slug: category } } }
          : undefined,
        user: city
          ? {
              locations: {
                some: {
                  city: {
                    contains: city,
                    mode: 'insensitive'
                  }
                }
              }
            }
          : undefined
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            locations: true
          }
        },
        categories: {
          include: { category: true }
        },
        portfolioItems: true,
        reviews: {
          select: { rating: true }
        }
      }
    });

    return specialists.map((specialist) => ({
      ...specialist,
      trustScore: this.calculateTrustScore(specialist)
    }));
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/profile')
  getMyProfile(@Req() req:any) {
    return this.prisma.specialist.findUnique({
      where: { userId: req.user.userId },
      include: {
        user: {
          select: {
            name: true,
            locations: true
          }
        },
        categories: {
          include: {
            category: true
          }
        },
        documents: true,
        portfolioItems: true
      }
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/portfolio')
  async addPortfolioItem(
    @Req() req: any,
    @Body() body: any
  ) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      throw new Error('El usuario no tiene perfil de especialista');
    }

    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim();
    const imageUrl = String(body.imageUrl || '').trim();

    if (!title) {
      throw new Error('El título es obligatorio');
    }

    return this.prisma.portfolioItem.create({
      data: {
        specialistId: specialist.id,
        title,
        description: description || null,
        imageUrl: imageUrl || null
      }
    });
  }

  @UseGuards(JwtAuthGuard)
  @UseGuards(JwtAuthGuard)
  @Patch('me/portfolio/:itemId')
  async updatePortfolioItem(
    @Req() req: any,
    @Param('itemId') itemId: string,
    @Body() body: any
  ) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      throw new Error('El usuario no tiene perfil de especialista');
    }

    const item = await this.prisma.portfolioItem.findFirst({
      where: {
        id: itemId,
        specialistId: specialist.id
      }
    });

    if (!item) {
      throw new Error('El elemento del portafolio no existe o no te pertenece');
    }

    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim();
    const imageUrl = String(body.imageUrl || '').trim();

    if (!title) {
      throw new Error('El título es obligatorio');
    }

    return this.prisma.portfolioItem.update({
      where: { id: item.id },
      data: {
        title,
        description: description || null,
        imageUrl: imageUrl || null
      }
    });
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/portfolio/:itemId')
  async deletePortfolioItem(
    @Req() req: any,
    @Param('itemId') itemId: string
  ) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      throw new Error('El usuario no tiene perfil de especialista');
    }

    const item = await this.prisma.portfolioItem.findFirst({
      where: {
        id: itemId,
        specialistId: specialist.id
      }
    });

    if (!item) {
      throw new Error('El elemento del portafolio no existe o no te pertenece');
    }

    return this.prisma.portfolioItem.delete({
      where: { id: item.id }
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/documents')
  async addVerificationDocument(
    @Req() req: any,
    @Body() body: any
  ) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      throw new Error('El usuario no tiene perfil de especialista');
    }

    const documentType = String(body.documentType || '').trim();
    const fileUrl = String(body.fileUrl || '').trim();

    if (!documentType) {
      throw new Error('El tipo de documento es obligatorio');
    }

    if (!fileUrl) {
      throw new Error('La URL del documento es obligatoria');
    }

    const document = await this.prisma.document.create({
      data: {
        specialistId: specialist.id,
        documentType,
        fileUrl,
        expirationDate: body.expirationDate
          ? new Date(body.expirationDate)
          : null,
        status: 'PENDING'
      }
    });

    await this.prisma.specialist.update({
      where: { id: specialist.id },
      data: { verificationStatus: 'UNDER_REVIEW' }
    });

    return document;
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/documents')
  async getMyVerificationDocuments(@Req() req: any) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { userId: req.user.userId }
    });

    if (!specialist) {
      throw new Error('El usuario no tiene perfil de especialista');
    }

    return this.prisma.document.findMany({
      where: { specialistId: specialist.id },
      orderBy: { createdAt: 'desc' }
    });
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/documents/pending')
  async getPendingVerificationDocuments() {
    return this.prisma.document.findMany({
      where: { status: 'PENDING' },
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
      },
      orderBy: { createdAt: 'asc' }
    });
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('admin/documents/:documentId/verify')
  async verifyDocument(
    @Param('documentId') documentId: string
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId }
    });

    if (!document) {
      throw new Error('El documento no existe');
    }

    await this.prisma.document.update({
      where: { id: document.id },
      data: { status: 'VERIFIED' }
    });

    const documents = await this.prisma.document.findMany({
      where: { specialistId: document.specialistId }
    });

    const verificationStatus = documents.some(
      (item) => item.status === 'PENDING'
    )
      ? 'UNDER_REVIEW'
      : documents.every((item) => item.status === 'VERIFIED')
        ? 'VERIFIED'
        : 'REJECTED';

    await this.prisma.specialist.update({
      where: { id: document.specialistId },
      data: { verificationStatus }
    });

    return this.prisma.document.findUnique({
      where: { id: document.id }
    });
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('admin/documents/:documentId/reject')
  async rejectDocument(
    @Param('documentId') documentId: string
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId }
    });

    if (!document) {
      throw new Error('El documento no existe');
    }

    await this.prisma.document.update({
      where: { id: document.id },
      data: { status: 'REJECTED' }
    });

    const documents = await this.prisma.document.findMany({
      where: { specialistId: document.specialistId }
    });

    const verificationStatus = documents.some(
      (item) => item.status === 'PENDING'
    )
      ? 'UNDER_REVIEW'
      : documents.every((item) => item.status === 'VERIFIED')
        ? 'VERIFIED'
        : 'REJECTED';

    await this.prisma.specialist.update({
      where: { id: document.specialistId },
      data: { verificationStatus }
    });

    return this.prisma.document.findUnique({
      where: { id: document.id }
    });
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const specialist = await this.prisma.specialist.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            name: true,
            locations: true
          }
        },
        categories: {
          include: { category: true }
        },
        documents: true,
        portfolioItems: true,
        reviews: {
          select: {
            rating: true,
            comment: true,
            createdAt: true
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });

    if (!specialist) {
      return null;
    }

    return {
      ...specialist,
      trustScore: this.calculateTrustScore(specialist)
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/profile')
  async updateMe(@Req() req:any,@Body() body:any){
    const { categoryIds = [], location, profile } = body;
    const specialist = await this.prisma.specialist.update({where:{userId:req.user.userId},data:profile});
    if (Array.isArray(categoryIds)) {
      await this.prisma.specialistCategory.deleteMany({where:{specialistId:specialist.id}});
      if(categoryIds.length) await this.prisma.specialistCategory.createMany({data:categoryIds.map((categoryId:string)=>({specialistId:specialist.id,categoryId}))});
    }
    if(location?.city && location?.state){
      const existing=await this.prisma.location.findFirst({where:{userId:req.user.userId}});
      if(existing) await this.prisma.location.update({where:{id:existing.id},data:location});
      else await this.prisma.location.create({data:{userId:req.user.userId,...location}});
    }
    return this.prisma.specialist.findUnique({where:{id:specialist.id},include:{user:{select:{name:true,locations:true}},categories:{include:{category:true}}}});
  }
}
