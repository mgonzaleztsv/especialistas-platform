import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Stripe = require('stripe');

@Injectable()
export class StripeEventRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  async recordVerifiedEvent(
    event: Stripe.Event,
  ): Promise<{
    recorded: boolean;
    duplicate: boolean;
    status: string;
  }> {
    if (process.env.STRIPE_MODE !== 'test') {
      throw new BadRequestException(
        'Registro Stripe desactivado',
      );
    }

    if (
      !event ||
      typeof event.id !== 'string' ||
      !/^evt_[A-Za-z0-9_]+$/.test(event.id) ||
      event.id.length > 255 ||
      typeof event.type !== 'string' ||
      event.type.length === 0 ||
      event.type.length > 255 ||
      event.livemode !== false
    ) {
      throw new BadRequestException(
        'Evento Stripe de pruebas inválido',
      );
    }

    try {
      const created = await this.prisma.stripeWebhookEvent.create({
        data: {
          stripeEventId: event.id,
          eventType: event.type,
          livemode: false,
          status: 'RECEIVED',
        },
      });

      return {
        recorded: true,
        duplicate: false,
        status: created.status,
      };
    } catch (error: unknown) {
      // La restricción UNIQUE resuelve las entregas concurrentes.
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }

      const existing =
        await this.prisma.stripeWebhookEvent.findUnique({
          where: { stripeEventId: event.id },
        });

      if (!existing) {
        // No ocultar una colisión que no podamos identificar.
        throw error;
      }

      if (
        existing.eventType !== event.type ||
        existing.livemode !== false
      ) {
        throw new BadRequestException(
          'Identificador Stripe con datos incompatibles',
        );
      }

      return {
        recorded: false,
        duplicate: true,
        status: existing.status,
      };
    }
  }
}
