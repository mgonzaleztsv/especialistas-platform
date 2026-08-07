import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('El correo ya está registrado');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(), email, phone: dto.phone, passwordHash, role: dto.role,
        client: dto.role === 'CLIENT' ? { create: {} } : undefined,
        specialist: dto.role === 'SPECIALIST' ? { create: {} } : undefined
      },
      select: { id:true, name:true, email:true, role:true }
    });
    return { user, accessToken: await this.sign(user.id, user.role) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) throw new UnauthorizedException('Credenciales incorrectas');
    return { user: { id:user.id, name:user.name, email:user.email, role:user.role }, accessToken: await this.sign(user.id, user.role) };
  }

  private sign(userId: string, role: string) {
    return this.jwt.signAsync({ sub:userId, role });
  }
}
