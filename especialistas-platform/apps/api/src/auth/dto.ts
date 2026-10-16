import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

enum PublicRole { CLIENT='CLIENT', SPECIALIST='SPECIALIST', BOTH='BOTH' }

export class RegisterDto {
  @IsString() name: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() phone?: string;
  @MinLength(8) password: string;
  @IsEnum(PublicRole) role: 'CLIENT' | 'SPECIALIST' | 'BOTH';
}

export class LoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
}
