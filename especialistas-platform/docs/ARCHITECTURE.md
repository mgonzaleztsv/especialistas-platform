# Arquitectura v0.1

Monorepo con dos aplicaciones: Next.js (`apps/web`) y NestJS (`apps/api`). PostgreSQL se ejecuta en Docker. Prisma gestiona el modelo relacional. La autenticación usa JWT. La estructura está dividida por dominios para poder separar servicios más adelante sin obligar al MVP a empezar con microservicios.
