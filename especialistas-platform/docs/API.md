# API v0.1

Base: `/api/v1`

- `POST /auth/register` registro público CLIENT o SPECIALIST.
- `POST /auth/login` devuelve JWT.
- `GET /users/me` usuario autenticado.
- `GET /categories` catálogo público.
- `GET /specialists` directorio público. Filtros opcionales `category` y `city`.
- `GET /specialists/:id` perfil público.
- `PATCH /specialists/me/profile` actualiza perfil profesional, categorías y ubicación.
- `GET /clients/me` perfil del cliente autenticado.
- `PATCH /clients/me` actualiza perfil del cliente.
