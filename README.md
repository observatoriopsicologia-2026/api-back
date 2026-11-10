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

## Recuperacion local (2026-11-03)

Se reactivo el proyecto original de Supabase y se restauro su conexion en `.env`,
conservando los otros ajustes y un respaldo privado en `.local-recovery/`.
No se creo otro proyecto ni se reimporto el dataset: la base conserva sus
854 documentos y el contenido del observatorio. Front y back corren localmente;
PostgreSQL sigue alojado en Supabase y requiere conexion a internet.

- Dataset: http://localhost:4200/dataset
- Administracion: http://localhost:4200/admin
- Estado API: http://localhost:4000/api/health

Los PDF existentes se recuperaron en `uploads/` desde la
[publicacion original de la revista](https://retosdelacienciaec.com/Revistas/index.php/retos/article/view/301).
No se cambiaron sus referencias en la base. `STORAGE_DRIVER=local` sigue activo
para pruebas; R2 se configura por separado para el despliegue. Los secretos,
los PDF y los respaldos privados estan excluidos de Git.

La migracion `database/migrations/20261103_protect_dataset_documents.sql` se
aplico con autorizacion: RLS bloquea acceso anonimo directo al dataset. La API
conecta como `postgres` y mantiene la consulta publica y el CRUD autenticado.
La verificacion posterior confirmo 854 registros para el backend y cero visibles
para el rol `anon`. Si habia una sesion del otro proyecto abierta, cerrar sesion
y volver a entrar antes de editar contenido.

Se fijo tambien el `search_path` de `public.set_updated_at` sin cambiar su
logica. La comprobacion posterior no reporto advertencias ni errores de
seguridad; los avisos informativos de RLS sin politicas son intencionales:
se bloquea acceso directo y la API usa el propietario de las tablas.

## Desplegar

Publica este repositorio como un Web Service Node en Render. `render.yaml`
declara el plan gratuito, con comprobacion en `/api/health`. Puede suspenderse
por inactividad y tener un primer arranque lento. No incluye disponibilidad
garantizada para una conferencia. Preparar este archivo no crea servicios.

Build command:

```bash
npm ci --include=dev && npm run build
```

Start command:

```bash
npm run start:prod
```

### Variables de produccion

Configura los valores en el panel de Render, nunca en GitHub ni en Angular:

- `NODE_ENV=production` y `NODE_VERSION=24`.
- `DATABASE_URL`: URI del session pooler de la Supabase de produccion.
- `JWT_SECRET`: secreto aleatorio de al menos 32 caracteres. El Blueprint puede generarlo.
- `CLIENT_ORIGIN`: URL HTTPS real del front, sin barra final. Se admiten varios origenes separados por coma.
- `STORAGE_DRIVER=r2`.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: credenciales de R2.
- `R2_BUCKET=observatorio-pdfs` (o el nombre real del bucket privado).
- `DATABASE_SSL_CA`: override opcional de la CA raiz PEM. Tambien admite `\n` literales.

La API verifica el certificado PostgreSQL y fuerza TLS para bases alojadas y
produccion. Las opciones SSL de la URI no pueden desactivar esa verificacion.
Si aparece un error de certificado, configura la CA correcta; no desactives la
verificacion. Los detalles de errores internos no se devuelven al cliente en produccion.

Para hosts de Supabase se incluye el certificado publico en
`certificates/supabase-prod-ca-2021.crt`, descargado de
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt.
No contiene claves privadas ni credenciales. Si Supabase cambia la CA, actualiza
el archivo desde su dashboard o configura `DATABASE_SSL_CA` con la CA vigente.

No hace falta configurar `ADMIN_EMAIL` y `ADMIN_PASSWORD` cuando ya existe un
administrador en la base migrada. Estas variables solo crean un usuario inicial
si falta; no cambian contrasenas de usuarios existentes.

### Almacenamiento y base de datos

1. Conserva Supabase para PostgreSQL y sus registros. Los PDF van en Cloudflare R2,
   no en Supabase Storage. Free sirve mientras la base y su uso respeten sus cuotas;
   no se necesita Pro por el solo hecho de tener 30 GB de archivos en R2.
2. Crea un bucket R2 privado `observatorio-pdfs` de clase Standard. El backend usa
   un token de objetos de lectura/escritura limitado a ese bucket. No habilites
   `r2.dev` publico. Revisa `DEPLOYMENT-CLOUDFLARE.md` para la configuracion completa.
3. La API permite actualmente hasta 15 MiB por PDF, aunque la capacidad total del
   bucket sea mayor. Ajustar ese limite y las subidas grandes es un trabajo separado.
4. Revisa `database/production-security.sql` y ejecutalo en la base de destino.
   Bloquea el acceso directo de `anon` y `authenticated` a las tablas de la app.
   Esta configuracion supone que Node conecta con el rol propietario `postgres`,
   como la conexion actual. Si usas otro rol, revisa sus privilegios y politicas RLS.
   No modifica las tablas de Storage ni configura sus politicas.
5. Prueba la API despues de aplicar permisos. No vuelvas a importar el dataset si
   sus registros ya estan presentes: la importacion carga metadatos, no los PDF.

La ruta `/api/publications/:id/file` sigue siendo publica para las publicaciones
del repositorio. El bucket privado evita acceso directo sin autorizacion de
Storage, pero no convierte esa ruta en privada. La distribucion de documentos
restringidos necesita autorizacion adicional en la API.

No guardes los documentos en el disco de Render. Los archivos locales desaparecen
al reiniciar. Conserva tambien una copia de los PDF fuera del bucket: las copias
de PostgreSQL no respaldan el contenido de Storage.

### Validacion antes de desplegar

```bash
npm run build
npm run coverage
```

`npm run verify` ejecuta cobertura y compilacion. `npm run storage:check`
prueba R2 con un objeto temporal que se elimina al finalizar; requiere las
cuatro variables R2 y no cambia el almacenamiento local de la aplicacion.
Solo despues de una prueba correcta, copiar los PDF con el comando de la guia.

Inicio, Indicadores y Dataset usan datos de PostgreSQL, sin contadores ni
graficas de demostracion. Los documentos ocultos solo se muestran a sesiones
admin/editor validas; el frontend incluye su token al consultar el dataset
administrativo. Las consultas publicas no muestran esos registros.

Cuando este desplegado, comprueba `/api/health`: debe responder 200 con
`databaseConnected=true` y `storageDriver=r2`. En produccion una base no
disponible devuelve 503 y un mensaje generico. El inicio de sesion admite hasta
10 intentos fallidos por IP cada 15 minutos. El contador vive en memoria y se
reinicia con la instancia; varias replicas necesitan un almacen compartido.

### Graficas sin Power BI

El frontend ahora dibuja con Chart.js sobre los datos de `/api/analytics` y
`/api/dataset/documents`. No necesita licencias Microsoft, iframe, gateway ni
refresh de un modelo importado. Se conservan por compatibilidad estas rutas:

- Indicadores: `/api/analytics/powerbi`.
- Documentos del dataset: `/api/dataset/powerbi/documents`.
- Resumen del dataset: `/api/dataset/powerbi`.

Estas rutas son publicas: solo deben exponer informacion autorizada para consulta
publica. Revisa el acceso y el contenido antes de cargar datos restringidos.
Los informes externos existentes no se modificaron. El nuevo reporte se actualiza
al recargar la API despues de guardar cambios administrativos.
