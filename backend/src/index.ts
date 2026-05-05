import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config.js';
import { seedAdminUser } from './auth.js';
import { errorHandler, notFound } from './http.js';
import router from './routes.js';

const app = express();

const origins = env.clientOrigin.split(',').map((origin) => origin.trim());

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

await seedAdminUser();

app.listen(env.port, () => {
  console.info(`Observatorio POT API listening on http://localhost:${env.port}`);
});
