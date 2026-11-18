# ConnectPro - Prisma 7 regression report

## Validation baseline

- Date: 2026-11-18
- Branch: upgrade/prisma7
- Validated commit: b627c3c
- Node.js: 24.14.0
- npm: 11.9.0
- Prisma: 7.10.1
- Prisma Client: 7.10.1
- Prisma PostgreSQL adapter: 7.10.1
- pg: 8.23.1
- pg-pool: 3.14.0

## Regression results

| Group | Passed | Total |
| --- | ---: | ---: |
| General test runner | 8 | 8 |
| Additional tests | 18 | 18 |
| PostgreSQL without Stripe | 22 | 22 |
| PostgreSQL with Stripe | 2 | 2 |
| Integration block A | 7 | 7 |
| Integration block B | 4 | 4 |
| Integration block C | 2 | 2 |
| Total files | 63 | 63 |

All planned regression files completed successfully
using the isolated test environment.

The report records the observed regression results.
It does not constitute production deployment approval.

## Compilation and schema validation

- Prisma schema validation: passed.
- Prisma Client generation: passed.
- NestJS compilation: passed.
- Next.js compilation: passed.

## Mandatory database isolation

Database tests and integration scripts must use:

- Database: connectpro_test.
- Host: localhost or 127.0.0.1.
- Port: 5433.
- User: connectpro_test.
- Schema: public.
- Environment file: .env.test.

Validate the effective DATABASE_URL before running tests.
Never print database credentials.

Do not reset or migrate the production database.

## Default regression environment

- NODE_ENV=test
- INTERNAL_MVP_PAYMENTS_ENABLED=false
- WORK_ORDER_EXPIRATION_ENABLED=false
- NODE_OPTIONS=--trace-deprecation

Remove inherited Stripe credentials before execution.

Special environment values must be restricted to
individual child processes.

Do not modify persistent configuration files.

## Payment simulation exceptions

The following tests require initial payment simulation
to be explicitly enabled:

- completion-correction-admin-deadline-db.test.cjs
- completion-correction-full-flow-db.test.cjs
- completion-correction-race-db.test.cjs

Set INTERNAL_MVP_PAYMENTS_ENABLED=true only for
these correction test processes.

Other tests may manage their own simulation state.

The following settlement tests require the initial
payment simulation setting to remain false:

- settlement-concurrency-db.test.cjs
- settlement-safety-db.test.cjs
- termination-settlement-db.test.cjs

## Stripe test configuration

Set STRIPE_MODE=test for:

- stripe-webhook-security.test.cjs
- stripe-event-concurrency-db.test.cjs
- stripe-webhook-http-db.test.cjs

For stripe-webhook-http-db.test.cjs, generate a
temporary fictional STRIPE_WEBHOOK_SECRET.

Do not provide real Stripe API keys.

Validated behavior:

- Valid webhook signatures return HTTP 200.
- Duplicate events return HTTP 200.
- Invalid or missing signatures return HTTP 400.
- Twelve concurrent deliveries produce one event.
- Eleven duplicate deliveries are recognized.
- Temporary Stripe event records are removed.

## Integration block A

Run sequentially:

1. integration-setup.cjs
2. integration-contract.cjs
3. integration-selection.cjs
4. integration-acceptance.cjs
5. integration-payment.cjs
6. integration-execution.cjs
7. integration-completion.cjs

Use a new shared UUID for CONNECTPRO_INTEGRATION_RUN_ID.

Enable payment simulation only for integration-payment
and integration-completion.

Keep automatic work order expiration disabled.

Validated execution identifier:

18914144-d6cb-4628-81bf-2319dae3b806

The complete simulated business cycle passed.

## Integration block B

- integration-budget-rule.cjs
- integration-full-flow.cjs
- integration-concurrency.cjs
- integration-unauthorized-access.cjs

Enable payment simulation only for integration-full-flow
and integration-concurrency.

Keep automatic work order expiration disabled.

## Integration block C

- integration-http-auth.cjs
- integration-http-permissions.cjs

Required configuration:

- CONNECTPRO_HTTP_TEST=true
- Temporary random JWT_SECRET of at least 32 characters.
- INTERNAL_MVP_PAYMENTS_ENABLED=false
- WORK_ORDER_EXPIRATION_ENABLED=false
- STRIPE_MODE=disabled

HTTP servers must listen on 127.0.0.1 using temporary ports.

Validated responses:

- Missing token: HTTP 401.
- Invalid token: HTTP 401.
- Authorized owner: HTTP 200.
- Unrelated client: HTTP 403.

## PostgreSQL compatibility warning

The known pg future compatibility warning was observed
during the final regression in:

- service-history-db.test.cjs
- termination-settlement-db.test.cjs

Both files passed.

The original transaction-related reproduction is
documented in prisma7-pg9-compatibility.md.

The specific query responsible for the service-history
warning has not been independently isolated.

The warning remains a future compatibility concern
and must not be silently suppressed.

Do not upgrade pg to version 9 without renewed
compatibility validation.

## Test data and safety

- Only the isolated PostgreSQL test database was used.
- No real Stripe credentials were supplied.
- Financial operations were simulated.
- Integration scripts may retain fictional test records.
- Do not perform indiscriminate database cleanup.
- No database migrations were executed during regression.
- Source code and dependencies remained unchanged.
- Local backup files were preserved.

## Final status

All 63 planned regression files passed.

No unresolved test failures remain in the validated
regression scope.

The known pg compatibility warning remains documented.

Final Git synchronization and merge verification
are still required before closing the upgrade branch.

## Validated file inventory

### Test files

- `admin-access-security.test.cjs`
- `completion-claim-admin-alerts.test.cjs`
- `completion-claim-admin-deadline.test.cjs`
- `completion-claim-admin-list.test.cjs`
- `completion-claim-admin-payment-block.test.cjs`
- `completion-claim-admin-payment-functional.test.cjs`
- `completion-claim-admin-race-db.test.cjs`
- `completion-claim-admin-resolve.test.cjs`
- `completion-claim-admin-vs-confirm-db.test.cjs`
- `completion-claim-concurrency-db.test.cjs`
- `completion-claim-controller.test.cjs`
- `completion-claim-dispute-aging.test.cjs`
- `completion-claim-disputed-at-db.test.cjs`
- `completion-claim-duplicate-db.test.cjs`
- `completion-claim-list.test.cjs`
- `completion-claim-payment-block.test.cjs`
- `completion-claim-response-db.test.cjs`
- `completion-claim-response-race-db.test.cjs`
- `completion-claim-response.test.cjs`
- `completion-claim-unique-db.test.cjs`
- `completion-claim-vs-close-db.test.cjs`
- `completion-confirmation-claim-db.test.cjs`
- `completion-confirmation-disabled.test.cjs`
- `completion-correction-admin-deadline-db.test.cjs`
- `completion-correction-admin-followup.test.cjs`
- `completion-correction-client-review.test.cjs`
- `completion-correction-finish.test.cjs`
- `completion-correction-full-flow-db.test.cjs`
- `completion-correction-race-db.test.cjs`
- `completion-endpoints-concurrency-db.test.cjs`
- `completion-endpoints-race-db.test.cjs`
- `contracting-concurrency-db.test.cjs`
- `contracting-db.test.cjs`
- `cors-security.test.cjs`
- `http-security.test.cjs`
- `payment-safety.test.cjs`
- `private-messaging-db.test.cjs`
- `private-messaging-http.test.cjs`
- `private-messaging.test.cjs`
- `review-deadlines.test.cjs`
- `service-history-db.test.cjs`
- `service-history-security.test.cjs`
- `settlement-concurrency-db.test.cjs`
- `settlement-safety-db.test.cjs`
- `stripe-event-concurrency-db.test.cjs`
- `stripe-webhook-http-db.test.cjs`
- `stripe-webhook-security.test.cjs`
- `stripe-webhook-signature.test.cjs`
- `termination-settlement-db.test.cjs`
- `work-order-expiration.test.cjs`

### Integration scripts

- `integration-acceptance.cjs`
- `integration-budget-rule.cjs`
- `integration-completion.cjs`
- `integration-concurrency.cjs`
- `integration-contract.cjs`
- `integration-execution.cjs`
- `integration-full-flow.cjs`
- `integration-http-auth.cjs`
- `integration-http-permissions.cjs`
- `integration-payment.cjs`
- `integration-selection.cjs`
- `integration-setup.cjs`
- `integration-unauthorized-access.cjs`
