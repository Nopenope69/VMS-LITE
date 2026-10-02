import dotenv from 'dotenv';

dotenv.config();

const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';

async function main() {
  // Import after dotenv so modules see the configured environment.
  const { waitForDatabase } = await import('./db/prisma.js');
  const { AuthService } = await import('./users/auth.service.js');
  const { createServer } = await import('./server.js');

  await waitForDatabase();

  // A fresh database has no users; create the installer admin so first login works.
  // The first-boot wizard forces this password to be changed.
  const admin = await new AuthService().seedInitialAdmin(
    'admin',
    process.env.ADMIN_INITIAL_PASSWORD || 'admin123'
  );
  if (admin) {
    console.log('[Basic VMS] Created initial admin account "admin". Change the password at first login.');
  }

  const app = await createServer();
  await app.listen({ port, host });
  console.log(`[Basic VMS] Control plane listening at http://${host}:${port}`);
}

main().catch((err) => {
  console.error('[Basic VMS] Fatal startup error:', err);
  process.exit(1);
});
