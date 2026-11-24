const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  StripeAccountCandidateSearchService: Service,
} = require('../dist/payments/stripe-account-candidate-search.service.js');

const {
  buildStripeAccountCreationIdentity: build,
} = require('../dist/payments/stripe-account-creation-identity.js');

test('Stripe: busqueda segura de candidatos', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  try {
    process.env.STRIPE_MODE = 'test';

    const requestId = randomUUID();
    const otherId = randomUUID();
    const country = 'MX';

    function account(id, matches = true, overrides = {}) {
      return {
        id: 'acct_' + id,
        object: 'account',
        country,
        livemode: false,
        metadata: build(
          matches ? requestId : otherId
        ),
        ...overrides,
      };
    }

    function page(data = [], hasMore = false) {
      return {
        object: 'list',
        data,
        has_more: hasMore,
      };
    }

    function fixture(pages = [], options = {}) {
      const calls = {
        client: 0,
        list: [],
      };

      const service = new Service({
        getClient() {
          calls.client++;

          return {
            accounts: {
              async list(params) {
                const index = calls.list.length;
                calls.list.push({ ...params });

                if (options.disable) {
                  process.env.STRIPE_MODE = 'disabled';
                }

                if (options.error) {
                  throw options.error;
                }

                if (index >= pages.length) {
                  throw new Error('Unexpected page');
                }

                return pages[index];
              },
            },
          };
        },
      });

      return {
        service,
        calls,
        search() {
          return service.searchCandidates(
            requestId, country
          );
        },
      };
    }

    await t.test('1 - Modo desactivado bloqueado', async () => {
      const f = fixture();
      delete process.env.STRIPE_MODE;

      try {
        await assert.rejects(f.search());
        assert.equal(f.calls.client, 0);
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('2 - Modo real bloqueado', async () => {
      const f = fixture();
      process.env.STRIPE_MODE = 'live';

      try {
        await assert.rejects(f.search());
        assert.equal(f.calls.client, 0);
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('3 - Solicitudes invalidas', async () => {
      const f = fixture();

      for (const value of [null, '', 1, 'invalid']) {
        await assert.rejects(
          f.service.searchCandidates(value, country)
        );
      }

      assert.equal(f.calls.client, 0);
    });

    await t.test('4 - Paises invalidos', async () => {
      const f = fixture();

      for (const value of [null, '', 'mx', 'MEX', '1X']) {
        await assert.rejects(
          f.service.searchCandidates(requestId, value)
        );
      }

      assert.equal(f.calls.client, 0);
    });

    await t.test('5 - Error externo sanitizado', async () => {
      const f = fixture([], {
        error: new Error('PRIVATE_EXTERNAL_MESSAGE'),
      });

      await assert.rejects(f.search(), error => {
        assert.equal(error.getStatus(), 502);
        assert.ok(
          !error.message.includes(
            'PRIVATE_EXTERNAL_MESSAGE'
          )
        );
        return true;
      });
    });

    await t.test('6 - Pagina inexistente', async () => {
      const f = fixture([null]);
      await assert.rejects(f.search());
    });

    await t.test('7 - Objeto de pagina incompatible', async () => {
      const f = fixture([
        { ...page(), object: 'account' },
      ]);
      await assert.rejects(f.search());
    });

    await t.test('8 - Datos de pagina invalidos', async () => {
      const f = fixture([
        { ...page(), data: null },
      ]);
      await assert.rejects(f.search());
    });

    await t.test('9 - Indicador de paginacion invalido', async () => {
      const f = fixture([
        { ...page(), has_more: 'false' },
      ]);
      await assert.rejects(f.search());
    });

    await t.test('10 - Pagina vacia con continuacion', async () => {
      const f = fixture([page([], true)]);
      await assert.rejects(f.search());
    });

    await t.test('11 - Pagina superior al limite', async () => {
      const data = Array.from(
        { length: 101 },
        (_, i) => account('Large' + i)
      );

      const f = fixture([page(data)]);
      await assert.rejects(f.search());
    });

    await t.test('12 - Cuenta inexistente', async () => {
      const f = fixture([page([null])]);
      await assert.rejects(f.search());
    });

    await t.test('13 - Objeto de cuenta incompatible', async () => {
      const f = fixture([
        page([
          account('Wrong', true, {
            object: 'customer',
          }),
        ]),
      ]);

      await assert.rejects(f.search());
    });

    await t.test('14 - Identificador de cuenta invalido', async () => {
      const f = fixture([
        page([
          account('Wrong', true, {
            id: 'cus_invalid',
          }),
        ]),
      ]);

      await assert.rejects(f.search());
    });

    await t.test('15 - Cuenta eliminada rechazada', async () => {
      const f = fixture([
        page([
          account('Deleted', true, {
            deleted: true,
          }),
        ]),
      ]);

      await assert.rejects(f.search());
    });

    await t.test('16 - Cuenta real rechazada', async () => {
      const f = fixture([
        page([
          account('Live', true, {
            livemode: true,
          }),
        ]),
      ]);

      await assert.rejects(f.search());
    });

    await t.test('17 - Duplicado dentro de una pagina', async () => {
      const a = account('Duplicate');

      const f = fixture([
        page([a, a]),
      ]);

      await assert.rejects(f.search());
    });

    await t.test('18 - Duplicado entre paginas', async () => {
      const a = account('Duplicate');

      const f = fixture([
        page([a], true),
        page([a]),
      ]);

      await assert.rejects(f.search());
    });

    await t.test('19 - Metadatos incompatibles descartados', async () => {
      const f = fixture([
        page([
          account('Other', false),
          account('Missing', true, {
            metadata: null,
          }),
        ]),
      ]);

      const r = await f.search();

      assert.equal(r.candidateCount, 0);
      assert.equal(r.accountsScanned, 2);
      assert.equal(r.searchComplete, true);
      assert.equal(r.retryAuthorized, false);
    });

    await t.test('20 - Pais candidato invalido', async () => {
      const f = fixture([
        page([
          account('InvalidCountry', true, {
            country: 'mex',
          }),
        ]),
      ]);

      await assert.rejects(f.search());
    });

    await t.test('21 - Discrepancia de pais conservada', async () => {
      const f = fixture([
        page([
          account('OtherCountry', true, {
            country: 'ES',
          }),
        ]),
      ]);

      const r = await f.search();

      assert.equal(r.candidateCount, 1);
      assert.equal(
        r.candidates[0].countryMatches,
        false
      );
      assert.equal(r.linkingAuthorized, false);
    });

    await t.test('22 - Candidato unico localizado', async () => {
      const f = fixture([
        page([
          account('Other', false),
          account('Correct'),
        ]),
      ]);

      const r = await f.search();

      assert.equal(r.candidateCount, 1);
      assert.equal(r.ambiguous, false);
      assert.equal(r.searchComplete, true);
      assert.deepEqual(r.candidates, [{
        stripeAccountId: 'acct_Correct',
        country: 'MX',
        countryMatches: true,
      }]);
    });

    await t.test('23 - Multiples candidatos detectados', async () => {
      const f = fixture([
        page([
          account('First'),
          account('Second'),
        ]),
      ]);

      const r = await f.search();

      assert.equal(r.candidateCount, 2);
      assert.equal(r.ambiguous, true);
      assert.equal(r.linkingAuthorized, false);
    });

    await t.test('24 - Paginacion y cursor correctos', async () => {
      const f = fixture([
        page([
          account('First', false),
          account('LastFirstPage', false),
        ], true),
        page([
          account('SecondPage'),
        ]),
      ]);

      const r = await f.search();

      assert.equal(r.pagesScanned, 2);
      assert.equal(r.accountsScanned, 3);
      assert.equal(r.candidateCount, 1);
      assert.equal(r.searchComplete, true);

      assert.deepEqual(f.calls.list, [
        { limit: 100 },
        {
          limit: 100,
          starting_after: 'acct_LastFirstPage',
        },
      ]);
    });

    await t.test('25 - Limite de diez paginas', async () => {
      const pages = Array.from(
        { length: 10 },
        (_, i) => page([
          account('Page' + i, false),
        ], true)
      );

      const f = fixture(pages);
      const r = await f.search();

      assert.equal(r.pagesScanned, 10);
      assert.equal(r.searchComplete, false);
      assert.equal(f.calls.list.length, 10);
      assert.equal(r.retryAuthorized, false);
      assert.equal(r.linkingAuthorized, false);
    });

    await t.test('26 - Busqueda de mil cuentas', async () => {
      const pages = Array.from(
        { length: 10 },
        (_, i) => page(
          Array.from(
            { length: 100 },
            (_, j) => account(
              'Bulk' + i + 'X' + j,
              false
            )
          ),
          i < 9
        )
      );

      const f = fixture(pages);
      const r = await f.search();

      assert.equal(r.pagesScanned, 10);
      assert.equal(r.accountsScanned, 1000);
      assert.equal(r.searchComplete, true);
      assert.equal(r.candidateCount, 0);
      assert.equal(r.retryAuthorized, false);
    });

    await t.test('27 - Desactivacion durante consulta', async () => {
      const f = fixture([page()], {
        disable: true,
      });

      try {
        await assert.rejects(f.search());
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('28 - Fechas de observacion coherentes', async () => {
      const f = fixture([page()]);
      const before = Date.now();

      const r = await f.search();

      assert.ok(
        r.observationStartedAt instanceof Date
      );
      assert.ok(
        r.searchCompletedAt instanceof Date
      );
      assert.ok(
        r.observationStartedAt.getTime() >= before
      );
      assert.ok(
        r.searchCompletedAt.getTime() >=
        r.observationStartedAt.getTime()
      );
      assert.ok(
        r.searchCompletedAt.getTime() <= Date.now()
      );
    });

    await t.test('29 - Datos sensibles excluidos', async () => {
      const f = fixture([
        page([
          account('Private', true, {
            email: 'private@example.invalid',
            external_accounts: {
              data: ['PRIVATE_BANK_DATA'],
            },
          }),
        ]),
      ]);

      const r = await f.search();

      assert.deepEqual(
        Object.keys(r.candidates[0]).sort(),
        [
          'stripeAccountId',
          'country',
          'countryMatches',
        ].sort()
      );

      assert.ok(
        !JSON.stringify(r).includes(
          'PRIVATE_BANK_DATA'
        )
      );

      assert.ok(
        !JSON.stringify(r).includes(
          'private@example.invalid'
        )
      );
    });

    await t.test('30 - Ningun resultado autoriza operaciones', async () => {
      for (const data of [
        [],
        [account('Unique')],
        [account('First'), account('Second')],
      ]) {
        const f = fixture([page(data)]);
        const r = await f.search();

        assert.equal(r.livemode, false);
        assert.equal(
          r.evidenceType,
          'ACCOUNT_DISCOVERY'
        );
        assert.equal(r.linkingAuthorized, false);
        assert.equal(r.retryAuthorized, false);
      }
    });

  } finally {
    if (previousMode === undefined) {
      delete process.env.STRIPE_MODE;
    } else {
      process.env.STRIPE_MODE = previousMode;
    }
  }
});
