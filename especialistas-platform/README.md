# Especialistas Platform — MVP v0.1

Esta versión cubre Sprint 1 y la base de Sprint 2: registro, login, roles, clientes, especialistas, categorías, ubicaciones, documentos y portafolio en el modelo de datos.

## La forma más fácil: GitHub Codespaces

No necesitas instalar Node, PostgreSQL ni Docker en tu Mac. Todo se ejecuta en GitHub.

### A. Subir este proyecto a GitHub

1. Descomprime el ZIP en tu Mac.
2. En GitHub abre tu repositorio `especialistas-platform`.
3. Pulsa **Add file** > **Upload files**.
4. Arrastra **el contenido de la carpeta descomprimida** a la ventana. No subas el ZIP cerrado si quieres trabajar con el código.
5. Escribe `Primera versión del MVP` en el mensaje y pulsa **Commit changes**.

### B. Abrir Codespaces

1. En la página principal del repositorio pulsa el botón verde **Code**.
2. Abre la pestaña **Codespaces**.
3. Pulsa **Create codespace on main**.
4. Espera a que aparezca el editor en el navegador.

### C. Preparar la base de datos

En Codespaces abre el menú **Terminal > New Terminal**. Ejecuta, una línea a la vez:

```bash
cp -n .env.example .env
```

```bash
docker compose up -d db
```

```bash
npm install
```

```bash
npm run db:generate
```

```bash
npm run db:migrate -- --name init
```

```bash
npm run db:seed
```

### D. Iniciar la aplicación

Ejecuta:

```bash
npm run dev
```

Codespaces detectará los puertos 3000 y 3001. En la pestaña **Ports**, abre el puerto **3000** para ver la aplicación.

## Qué puedes probar

1. Crear una cuenta como Cliente.
2. Cerrar sesión.
3. Crear otra cuenta como Especialista.
4. Iniciar sesión.
5. Abrir el directorio de especialistas.
6. Probar la API del perfil profesional desde un cliente REST cuando avancemos al siguiente paso.

## Importante

Esta es una versión de desarrollo, no de producción. Antes de manejar pagos, documentos reales o información sensible hay que añadir controles adicionales de seguridad, verificación, almacenamiento privado y cumplimiento legal.
