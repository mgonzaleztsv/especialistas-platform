import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  StripeTestClientService,
} from './stripe-test-client.service';

import {
  buildStripeAccountCreationIdentity,
  matchesStripeAccountCreationIdentity,
} from './stripe-account-creation-identity';

@Injectable()
export class StripeAccountCandidateSearchService {
  constructor(
    private readonly stripeClient: StripeTestClientService,
  ) {}

  private assertTestMode(): void {
    if (process.env.STRIPE_MODE !== 'test') {
      throw new ServiceUnavailableException(
        'Busqueda Stripe disponible solo en pruebas',
      );
    }
  }

  async searchCandidates(
    requestId: string,
    expectedCountry: string,
  ) {
    this.assertTestMode();

    try {
      buildStripeAccountCreationIdentity(requestId);
    } catch {
      throw new BadRequestException(
        'Identificador de solicitud invalido',
      );
    }

    if (
      typeof expectedCountry !== 'string' ||
      !/^[A-Z]{2}$/.test(expectedCountry)
    ) {
      throw new BadRequestException(
        'Codigo de pais invalido',
      );
    }

    const pageLimit = 100;
    const maxPages = 10;

    const observationStartedAt = new Date();

    const client = this.stripeClient.getClient();

    const seen = new Set<string>();

    const candidates: {
      stripeAccountId: string;
      country: string;
      countryMatches: boolean;
    }[] = [];

    let cursor: string | undefined;
    let pagesScanned = 0;
    let accountsScanned = 0;
    let searchComplete = false;

    while (pagesScanned < maxPages) {
      this.assertTestMode();

      let page;

      try {
        page = await client.accounts.list({
          limit: pageLimit,
          ...(cursor
            ? { starting_after: cursor }
            : {}),
        });
      } catch {
        throw new BadGatewayException(
          'No fue posible consultar las cuentas Stripe',
        );
      }

      this.assertTestMode();

      if (
        !page ||
        page.object !== 'list' ||
        !Array.isArray(page.data) ||
        page.data.length > pageLimit ||
        typeof page.has_more !== 'boolean' ||
        (page.has_more && page.data.length === 0)
      ) {
        throw new BadGatewayException(
          'Pagina de cuentas Stripe incompatible',
        );
      }

      pagesScanned++;

      for (const account of page.data) {
        if (
          !account ||
          account.object !== 'account' ||
          typeof account.id !== 'string' ||
          account.id.length > 255 ||
          !/^acct_[A-Za-z0-9]+$/.test(account.id)
        ) {
          throw new BadGatewayException(
            'Identidad de cuenta incompatible',
          );
        }

        const deleted: unknown =
          Reflect.get(account, 'deleted');

        if (
          deleted === true ||
          (
            'livemode' in account &&
            account.livemode !== false
          )
        ) {
          throw new BadGatewayException(
            'Cuenta externa no autorizada',
          );
        }

        if (seen.has(account.id)) {
          throw new BadGatewayException(
            'Cuenta repetida durante la paginacion',
          );
        }

        seen.add(account.id);
        accountsScanned++;

        if (
          !matchesStripeAccountCreationIdentity(
            requestId,
            Reflect.get(account, 'metadata'),
          )
        ) {
          continue;
        }

        if (
          typeof account.country !== 'string' ||
          !/^[A-Z]{2}$/.test(account.country)
        ) {
          throw new BadGatewayException(
            'Pais de cuenta candidata invalido',
          );
        }

        candidates.push({
          stripeAccountId: account.id,
          country: account.country,
          countryMatches:
            account.country === expectedCountry,
        });
      }

      if (!page.has_more) {
        searchComplete = true;
        break;
      }

      const nextCursor =
        page.data[page.data.length - 1].id;

      if (nextCursor === cursor) {
        throw new BadGatewayException(
          'Cursor Stripe repetido',
        );
      }

      cursor = nextCursor;
    }

    this.assertTestMode();

    const searchCompletedAt = new Date();

    return {
      requestId,
      expectedCountry,
      livemode: false as const,
      observationStartedAt,
      searchCompletedAt,
      pagesScanned,
      accountsScanned,
      searchComplete,
      candidates,
      candidateCount: candidates.length,
      ambiguous: candidates.length > 1,
      evidenceType: 'ACCOUNT_DISCOVERY' as const,
      linkingAuthorized: false as const,
      retryAuthorized: false as const,
    };
  }
}
