import dotenv from 'dotenv';
import { createServer } from './server.js';

dotenv.config();

const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';

async function main() {
  const app = await createServer();
  try {
    await app.listen({ port, host });
    console.log(`[Basic VMS] Control plane listening at http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
