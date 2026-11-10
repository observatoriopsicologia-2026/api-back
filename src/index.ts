import { env } from './config.js';
import { seedAdminUser } from './auth.js';
import { createApp } from './app.js';

const app = createApp();

await seedAdminUser();

app.listen(env.port, () => {
  console.info(`Observatorio POT API listening on http://localhost:${env.port}`);
});
