import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config.js';
import { errorHandler, notFound } from './http.js';
import router from './routes.js';

export function createApp() {
  const app = express();
  const origins = env.clientOrigin.split(',').map((origin) => origin.trim());

  if (env.nodeEnv === 'production') {
    app.set('trust proxy', 1);
  }

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
