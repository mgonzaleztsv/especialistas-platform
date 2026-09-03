import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('specialists')
export class SpecialistsController {
  constructor(private prisma:PrismaService) {}

  @Get()
  list(@Query('category') category?:string,@Query('city') city?:string){
    return this.prisma.specialist.findMany({
      where:{
        categories: category ? {some:{category:{slug:category}}}:undefined,
        user: city ? {locations:{some:{city:{contains:city,mode:'insensitive'}}}}:undefined
      },
      include:{user:{select:{id:true,name:true,locations:true}},categories:{include:{category:true}},portfolioItems:true,reviews:{select:{rating:true}}}
    });
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

  @Get(':id')
  one(@Param('id') id:string){return this.prisma.specialist.findUnique({where:{id},include:{user:{select:{name:true,locations:true}},categories:{include:{category:true}},documents:true,portfolioItems:true,reviews:{
    select:{
      rating:true,
      comment:true,
      createdAt:true
    },
    orderBy:{
      createdAt:'desc'
    }
  }}});}

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
