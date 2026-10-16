import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('users')
export class UsersController {
  constructor(private prisma:PrismaService) {}
  @UseGuards(JwtAuthGuard)
  @Post('me/enable-client')
  async enableClient(@Req() req: any) {
    const existingClient = await this.prisma.client.findUnique({
      where: { userId: req.user.userId }
    });

    if (existingClient) {
      return {
        message: 'La función de contratación ya está habilitada.',
        client: existingClient
      };
    }

    const client = await this.prisma.client.create({
      data: {
        userId: req.user.userId
      }
    });

    return {
      message: 'Función de contratación habilitada correctamente.',
      client
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req:any) {
    return this.prisma.user.findUnique({ where:{id:req.user.userId}, select:{id:true,name:true,email:true,phone:true,role:true,status:true,client:{include:{specialistReviews:{select:{rating:true}}}},specialist:{include:{reviews:{select:{rating:true}}}},locations:true} });
  }
}
