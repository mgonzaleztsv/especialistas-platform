import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('users')
export class UsersController {
  constructor(private prisma:PrismaService) {}
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req:any) {
    return this.prisma.user.findUnique({ where:{id:req.user.userId}, select:{id:true,name:true,email:true,phone:true,role:true,status:true,client:true,specialist:true,locations:true} });
  }
}
