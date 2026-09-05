import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('specialists')
export class SpecialistsController {
  constructor(private prisma:PrismaService) {}

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

  @Get()
  async list(
    @Query('category') category?: string,
    @Query('city') city?: string
  ) {
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
