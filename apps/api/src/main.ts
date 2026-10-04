import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Controller, Get, Inject, Module } from '@nestjs/common';
import helmet from 'helmet';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Database } from './database.js';
import { SessionGuard, Security, SafeErrors } from './security.js';
import { AuthController, AuthService } from './auth.js';
import { SyncController, SyncService } from './sync.js';
import { PairingController } from './pairing.js';
import { DeveloperController, MfaController, MfaService } from './mfa.js';
import { VerifierKeys } from './kms.js';
@Controller('health')
class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    const result = await this.db.query<{ version: number }>(
      'SELECT max(version) AS version FROM schema_migrations',
    );
    if (result.rows[0]?.version !== 4) throw new Error('Database schema is not ready.');
    return { status: 'ready' };
  }
}
@Module({
  providers: [Database, Security, SessionGuard, AuthService, SyncService, VerifierKeys, MfaService],
  controllers: [
    HealthController,
    AuthController,
    SyncController,
    PairingController,
    DeveloperController,
    MfaController,
  ],
})
class AppModule {}
const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
const db = app.get(Database),
  security = app.get(Security);
app.getHttpAdapter().getInstance().set('trust proxy', db.config.TRUST_PROXY_HOPS);
app.setGlobalPrefix('api');
app.useGlobalFilters(new SafeErrors());
app.enableShutdownHooks();
app.use(
  helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  }),
);
app.use(async (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.headers.origin !== db.config.APP_ORIGIN && !req.path.startsWith('/api/mfa/')) {
      res.status(403).json({ message: 'Access denied.' });
      return;
    }
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') {
      res.status(403).json({ message: 'Access denied.' });
      return;
    }
    if (
      req.headers['content-type']?.split(';')[0] !== 'application/json' &&
      !req.path.startsWith('/api/mfa/')
    ) {
      res.status(415).json({ message: 'JSON required.' });
      return;
    }
  }
  try {
    if (!req.path.startsWith('/api/health/'))
      await security.limit(req.ip ?? 'unknown', 'request', 180, 60);
    next();
  } catch {
    res.status(429).json({ message: 'Try again later.' });
  }
});
app.use('/api/vaults/:id/rotate', express.json({ limit: '24mb', strict: true }));
app.use(express.json({ limit: '1mb', strict: true }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    error && typeof error === 'object' && 'status' in error && error.status === 413 ? 413 : 400;
  res.status(status).json({ message: status === 413 ? 'Request too large.' : 'Invalid request.' });
});
const cleanup = () =>
  db.query(
    "DELETE FROM challenges WHERE expires_at<now(); DELETE FROM sessions WHERE expires_at<now(); DELETE FROM rate_limits WHERE expires_at<now(); DELETE FROM pairings WHERE expires_at<now(); DELETE FROM security_events WHERE created_at<now()-interval '90 days'; DELETE FROM verifier.credentials WHERE active=false AND enrollment_expires<now()",
  );
await cleanup();
setInterval(() => {
  void cleanup().catch(() => process.stderr.write('Scheduled database cleanup failed.\n'));
}, 600000).unref();
await app.listen(db.config.PORT, '0.0.0.0');
process.stdout.write(`Still API ready on port ${db.config.PORT}.\n`);
