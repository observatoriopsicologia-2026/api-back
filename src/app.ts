import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { fileURLToPath } from 'node:url';
import { env } from './config.js';
import { errorHandler, notFound } from './http.js';
import router from './routes.js';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

export function createApp() {
  const app = express();
  const origins = env.clientOrigin.split(',').map((origin) => origin.trim());

  if (env.nodeEnv === 'production') {
    app.set('trust proxy', 1);
  }

  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'Observatorio POT API',
        version: '1.0.0',
        description: 'Documentación de la API'
      }
    },
    apis: [fileURLToPath(new URL('./routes.*', import.meta.url)).replaceAll('\\', '/')]
  });
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
      xFrameOptions: false
    })
  );
  app.use(
    cors({
      origin: origins,
      credentials: true
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.post(
    '/api/auth/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      message: { error: 'Demasiados intentos de acceso. Intenta de nuevo en 15 minutos.' }
    })
  );

  app.use('/api', router);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
