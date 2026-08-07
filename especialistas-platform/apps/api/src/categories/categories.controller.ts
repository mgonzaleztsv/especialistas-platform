import { Controller, Get } from '@nestjs/common'; import { PrismaService } from '../prisma/prisma.service';
@Controller('categories') export class CategoriesController { constructor(private prisma:PrismaService){} @Get() list(){return this.prisma.category.findMany({where:{active:true},orderBy:{name:'asc'}});} }
