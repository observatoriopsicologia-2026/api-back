# Observatorio POT Frontend

Aplicación Angular pública y panel administrador del Observatorio POT.

## Instalar

```bash
cd frontend
npm install
```

## Configurar API

Para local usa `src/environments/environment.ts`.

Para producción actualiza `src/environments/environment.prod.ts`:

```ts
apiUrl: 'https://tu-api.onrender.com/api'
```

## Ejecutar

```bash
npm start
```

La web queda en `http://localhost:4200`.

Si Windows muestra `spawn EPERM` con `esbuild`, cierra el `ng serve` que esté vivo con `Ctrl + C` y vuelve a ejecutar el build. Puedes validar tipos sin generar bundle con:

```bash
npm run typecheck
```

## Desplegar

Puedes desplegar esta carpeta como proyecto independiente en Netlify Free.

Build command:

```bash
npm install && npm run build
```

Publish directory:

```text
dist/observatorio-pot-web/browser
```
