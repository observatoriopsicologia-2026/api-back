import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config.js';
import { errorHandler, notFound } from './http.js';
import router from './routes.js';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

export function createApp() {
  const app = express();
  const origins = env.clientOrigin.split(',').map((origin) => origin.trim());
  const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Observatorio POT API',
      version: '1.0.0',
      description: 'Documentación de la API'
    }
  },
  apis: ['./src/**/*.ts']
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
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

  app.use('/api', router);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
