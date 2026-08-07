import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('clients')
@UseGuards(JwtAuthGuard)
export class ClientsController {
  constructor(private prisma:PrismaService) {}
  @Get('me') me(@Req() req:any){ return this.prisma.client.findUnique({where:{userId:req.user.userId},include:{user:true}}); }
  @Patch('me') update(@Req() req:any,@Body() body:{clientType?:string;companyName?:string}){
    return this.prisma.client.update({where:{userId:req.user.userId},data:body});
  }
}
