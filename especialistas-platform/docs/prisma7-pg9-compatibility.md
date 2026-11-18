# ConnectPro - Compatibilidad Prisma 7 y pg 9

Fecha: 2026-11-18
Diagnostico: pasos 1177-A a 1177-D
Rama: upgrade/prisma7
Commit de referencia: fddf73c

## Entorno validado

- Node.js: 24.14.0
- NPM: 11.9.0
- Prisma: 7.10.1
- Prisma Client: 7.10.1
- Prisma adapter-pg: 7.10.1
- pg: 8.23.1
- pg-pool: 3.14.0

Las dependencias directas examinadas tienen versiones
exactas en package.json. El lockfile conserva las
versiones instaladas.

## Advertencia

Calling client.query() when the client is already
executing a query is deprecated and will be removed
in pg@9.0.

## Origen observado

La advertencia aparece en:

- pg Client.query
- Prisma adapter-pg PgTransaction.performIO
- Prisma adapter-pg PgTransaction.queryRaw
- Prisma Client runtime

Se reprodujo mediante una consulta findUnique con
multiples relaciones include dentro de una transaccion
interactiva, sin ejecutar el controlador de ConnectPro
ni operaciones financieras.

La misma consulta fuera de la transaccion no produjo
la advertencia durante la prueba realizada.

## Pruebas financieras verificadas

- settlement-safety-db.test.cjs: PASS.
- termination-settlement-db.test.cjs: PASS.
- settlement-concurrency-db.test.cjs: PASS.

La advertencia solo aparecio en la prueba de
liquidacion por terminacion.

No se detectaron movimientos duplicados.
Se conservaron las protecciones de liquidacion.
Las pruebas se realizaron en connectpro_test,
PostgreSQL local, puerto 5433.

## Decision tecnica

Mantener las versiones actualmente verificadas.

No modificar el codigo financiero exclusivamente
para eliminar esta advertencia.

No modificar manualmente node_modules.
No ocultar las advertencias.
No debilitar las pruebas de concurrencia.
No actualizar pg a la version 9 sin validacion previa.

Utilizar npm ci para instalaciones reproducibles
a partir del lockfile versionado.

## Validacion futura

Antes de actualizar Prisma o pg:

1. Revisar compatibilidad y notas de versiones.
2. Reproducir la consulta dentro de una transaccion.
3. Ejecutar las pruebas financieras aisladas.
4. Ejecutar las pruebas de concurrencia.
5. Verificar ausencia de movimientos duplicados.
6. Verificar reversion de registros ficticios.
7. Ejecutar la suite general de regresion.

## Estado

Diagnostico concluido.
Compatibilidad futura con pg 9 pendiente.
Pendiente tecnico no bloqueante para el entorno
actualmente validado.

No se garantiza la ausencia de esta advertencia
en otros flujos de la aplicacion.
