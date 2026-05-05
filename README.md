# Observatorio POT Backend

API Node.js + TypeScript + Express para el Observatorio POT.

## Instalar

```bash
cd backend
npm install
```

## Configurar

Copia `.env.example` como `.env` y completa:

- `DATABASE_URL`
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- Supabase Storage si usarás `STORAGE_DRIVER=supabase`

Ejecuta `database/schema.sql` en Supabase. Opcionalmente ejecuta `database/seed.sql`.

El proyecto incluye un `.env` local básico para que el servidor arranque. Sin `DATABASE_URL`, `/api/health` funciona, pero login, admin y contenido devolverán un aviso de base de datos no configurada.

## Ejecutar

```bash
npm run dev
```

La API queda en `http://localhost:4000/api`.

También puedes usar `npm start` para compilar y correr localmente sin modo observación.

Para producción usa:

```bash
npm run build
npm run start:prod
```

## Desplegar

Puedes desplegar esta carpeta como proyecto independiente en Render Free.

Build command:

```bash
npm install && npm run build
```

Start command:

```bash
npm run start:prod
```
