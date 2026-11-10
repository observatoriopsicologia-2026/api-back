# Despliegue: Pages + Render + Supabase + R2

## Arquitectura

- Angular: Cloudflare Pages (hosting estatico). Build `npm ci --include=dev && npm run build`;
  salida `dist/observatorio-pot-web/browser`; Node 24.
- API Express/TypeScript: Render Web Service, configurado en `render.yaml`.
  No se convierte Express a Workers: eso requeriria otro trabajo de compatibilidad.
- PostgreSQL: Supabase actual. No se cambia esquema ni se reimportan datos para R2.
- PDF de publicaciones: bucket privado Cloudflare R2. Sus claves se mantienen
  en `publications.file_path`. El resto de metadatos sigue en PostgreSQL.
- Graficas: Chart.js en el navegador. Sin licencias Power BI ni datos fijos.

Preparar estos archivos no crea cuentas, buckets, servicios, facturas ni un despliegue.

## Datos necesarios

1. Acceso del propietario a Cloudflare y conexion a GitHub para Pages.
2. R2 activado, bucket privado Standard y credenciales S3 de objetos Read & Write
   limitadas a ese bucket: Account ID, Access Key ID y Secret Access Key.
   No es el token general de Cloudflare ni una clave de Supabase.
3. `DATABASE_URL` vigente del session pooler de la base que contiene los datos.
4. Acceso a Render y al repositorio `api-back`. El Blueprint usa el plan gratuito
   elegido para esta etapa; no crea una instancia de pago. Tener en cuenta sus
   arranques frios y limites de disponibilidad.
5. URLs finales del frontend y backend; dominio propio es opcional.
6. Carpeta de los PDF locales actuales para copiarlos antes de dejar de usar disco.

Guardar secretos en `api-back/.env` (ignorado por Git) para las pruebas locales,
y en las variables protegidas de Render para produccion. Nunca en Angular,
GitHub, screenshots ni mensajes de chat. No hace falta Supabase service-role
cuando el almacenamiento es R2 y PostgreSQL se conecta por su URI.

## Secuencia

1. Probar `DATABASE_URL`: `/api/health` debe indicar conexion correcta. Si el
   proveedor responde tenant/user not found, corregir la URI desde Connect;
   cambiar de almacenamiento no resuelve una conexion PostgreSQL invalida.
2. Completar las variables R2 de `.env.example`. Usar `STORAGE_DRIVER=r2` para
   probar R2; mantener `local` hasta contar con credenciales funcionales.
3. Crear Pages para obtener su URL. Ponerla como `CLIENT_ORIGIN` en Render,
   HTTPS sin barra final. Aplicar CORS en R2 usando `deployment/r2-cors.example.json`,
   sustituyendo el origen por el real. No autorizar origenes comodin innecesarios.
4. Publicar API y configurar todas las variables indicadas en README. Revisar
   permisos RLS en `database/production-security.sql` antes de ejecutarlo.
5. Configurar `API_URL` en las variables de compilacion de Cloudflare Pages con
   la URL HTTPS real de Render terminada en `/api`; publicar de nuevo Pages.
   El comando `prebuild` genera el ambiente publico; las claves nunca van alli.
6. Probar login, CRUD, upload, preview, descarga y borrado; comprobar tras
   reinicio de la API. Probar sin iniciar sesion en Microsoft.

La API firma enlaces GET de cinco minutos para visualizar o descargar. R2 entrega
los bytes directamente; el servidor no duplica el trafico de descarga. El bucket
es privado, pero las publicaciones son publicas mediante su endpoint de la API.
Los enlaces firmados son de portador: cualquiera que los tenga puede usarlos
hasta que expiren. Documentos restringidos necesitan autorizacion adicional.
El limite actual sigue siendo 15 MiB por archivo, no por bucket.

## PDF existentes

Cambiar `STORAGE_DRIVER` NO copia archivos. Para PDF guardados localmente:

```powershell
npm run build
node scripts/migrate-local-pdfs-to-r2.mjs
```

El comando anterior solo inventaria referencias locales; no sube nada. Con
las claves R2 completas, primero ejecutar `npm run storage:check` y revisar
errores antes de la copia efectiva:

```powershell
node scripts/migrate-local-pdfs-to-r2.mjs --apply
```

Procesa solo PDF referenciados por `publications.file_path`, conserva sus claves,
lee archivos como streams, verifica SHA-256 para reejecuciones y no sobrescribe
objetos existentes sin checksum coincidente. No modifica tablas ni borra origenes.
Si hay archivos faltantes o provenientes de Supabase Storage, deben recuperarse
de su origen antes del cambio. Confirmar siempre preview/descarga de una muestra.

El dataset contiene metadatos y enlaces externos. `local_file` del dataset NO
equivale a un PDF ya subido a R2. La importacion original y esta herramienta no
cargan masivamente esos documentos ni cambian sus enlaces. Para alojarlos tambien,
primero se necesita su carpeta real y definir el mapeo de cada archivo al registro.
Guardar una copia de seguridad de los PDF fuera del bucket.

## Costos y limites

Chart.js usa licencia MIT. Las graficas no generan cobros de Power BI.
R2 Standard incluye 10 GB-mes gratuitos; el excedente de almacenamiento cuesta
USD 0.015/GB-mes. 30 GB estables durante un mes equivalen aproximadamente a
USD 0.30/mes SOLO en almacenamiento, dentro de las cuotas gratuitas de operaciones.
Las operaciones excedentes y otros servicios pueden cobrar. R2 requiere activar
facturacion; no se promete costo cero para 30 GB. Verificar precios al contratar:
https://developers.cloudflare.com/r2/pricing/

Supabase Free tiene cuotas y puede pausar proyectos inactivos. Render es un costo
separado si se cambia a un plan de pago; el Blueprint actual usa `free`. Para una conferencia, comprobar disponibilidad
y carga antes de la presentacion; la modalidad gratuita no es una garantia de SLA.

## Validaciones completadas (2026-11-03)

Se compararon 14 series de la API con los registros fuente y se verificaron las
10 graficas renderizadas de Inicio, Indicadores y Dataset, con pruebas de filtros,
matriz, clics en barras y canvas no vacio a 1440 y 390 px. Las cifras guardadas
eran 854 documentos (ILO 499, UN 355), 2 publicaciones y 4 investigadores.
La prueba de permisos creo y elimino solo un registro temporal oculto. El
administrador pudo leerlo y actualizarlo; las consultas publicas no lo expusieron.

No se ha publicado un sitio, creado un servicio ni cargado PDF a R2 durante
estas comprobaciones. Para hacerlo faltan las credenciales del bucket, acceso
a los destinos de despliegue y cambiar las credenciales de desarrollo antes
de exponer el administrador en internet.
