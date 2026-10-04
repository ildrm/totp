import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
  UnauthorizedException,
  ConflictException,
  PayloadTooLargeException,
  Param,
  Delete,
} from '@nestjs/common';
import { timingSafeEqual, randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Request } from 'express';
import {
  generateSecret,
  serializeUri,
  totp,
  hotp,
  type OtpInput,
} from '../../../packages/core/src/index.js';
import { Database } from './database.js';
import { VerifierKeys } from './kms.js';
import { Security, SessionGuard, recent, hash, token, type AuthRequest } from './security.js';
type ApiIdentity = { applicationId: string; scopes: string[] };
type Credential = {
  id: string;
  application_id: string;
  subject_hash: string;
  type: 'totp' | 'hotp';
  algorithm: OtpInput['algorithm'];
  digits: 6 | 8;
  period: number;
  counter: string;
  last_step: string;
  active: boolean;
  envelope: unknown;
  replaces_id: string | null;
  enrollment_expires: Date | null;
};
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
@Injectable()
export class MfaService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Security) private readonly security: Security,
    @Inject(VerifierKeys) private readonly keys: VerifierKeys,
  ) {}
  async authorize(request: Request, scope: string): Promise<ApiIdentity> {
    if (this.db.config.MFA_ENABLED !== 'true') throw new ForbiddenException();
    const bearer = request.headers.authorization?.match(/^Bearer (still_[A-Za-z0-9_-]{43})$/)?.[1];
    if (!bearer) throw new UnauthorizedException();
    const r = await this.db.query<{ application_id: string; scopes: string[] }>(
      'UPDATE verifier.api_keys SET last_used=now() WHERE verifier=$1 AND revoked_at IS NULL AND expires_at>now() RETURNING application_id,scopes',
      [hash(bearer)],
    );
    const identity = r.rows[0];
    if (!identity || !identity.scopes.includes(scope)) throw new UnauthorizedException();
    await this.security.limit(identity.application_id, 'verifier-api', 120, 60);
    return { applicationId: identity.application_id, scopes: identity.scopes };
  }
  async enroll(body: unknown, identity: ApiIdentity) {
    const input = z
      .object({
        subject: z.uuid(),
        issuer: z.string().trim().min(1).max(128),
        account: z.string().trim().min(1).max(256),
        type: z.enum(['totp', 'hotp']).default('totp'),
        algorithm: z.enum(['SHA-1', 'SHA-256', 'SHA-512']).default('SHA-256'),
        digits: z.union([z.literal(6), z.literal(8)]).default(8),
        period: z.number().int().min(5).max(300).default(30),
        replacesCredentialId: z.uuid().optional(),
      })
      .strict()
      .parse(body);
    const id = randomUUID(),
      secret = generateSecret(input.algorithm === 'SHA-512' ? 512 : 256);
    const envelope = await this.keys.encrypt(secret, identity.applicationId, id);
    await this.db.transaction(async (c) => {
      await c.query('SELECT id FROM verifier.applications WHERE id=$1 FOR UPDATE', [
        identity.applicationId,
      ]);
      const count = await c.query<{ count: string }>(
        'SELECT count(*) FROM verifier.credentials WHERE application_id=$1',
        [identity.applicationId],
      );
      if (Number(count.rows[0]!.count) >= 10000) throw new PayloadTooLargeException();
      const active = await c.query(
        'SELECT id FROM verifier.credentials WHERE application_id=$1 AND subject_hash=$2 AND active=true',
        [identity.applicationId, hash(`${identity.applicationId}:${input.subject}`)],
      );
      if (active.rowCount && !input.replacesCredentialId) throw new ConflictException();
      if (input.replacesCredentialId) {
        const previous = await c.query(
          'SELECT id FROM verifier.credentials WHERE id=$1 AND application_id=$2 AND subject_hash=$3 AND active=true FOR UPDATE',
          [
            input.replacesCredentialId,
            identity.applicationId,
            hash(`${identity.applicationId}:${input.subject}`),
          ],
        );
        if (!previous.rowCount) throw new ForbiddenException();
      }
      await c.query(
        "INSERT INTO verifier.credentials(id,application_id,subject_hash,type,algorithm,digits,period,envelope,replaces_id,enrollment_expires) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '24 hours')",
        [
          id,
          identity.applicationId,
          hash(`${identity.applicationId}:${input.subject}`),
          input.type,
          input.algorithm,
          input.digits,
          input.period,
          JSON.stringify(envelope),
          input.replacesCredentialId ?? null,
        ],
      );
    });
    const { subject: _subject, replacesCredentialId: _replacement, ...parameters } = input;
    return { credentialId: id, uri: serializeUri({ ...parameters, secret, counter: '0' }) };
  }
  async verify(id: string, body: unknown, identity: ApiIdentity, activate = false) {
    z.uuid().parse(id);
    const input = z
      .object({ code: z.string().regex(/^\d{6}(\d{2})?$|^[A-Za-z0-9_-]{22}$/) })
      .strict()
      .parse(body);
    await this.security.limit(`${identity.applicationId}:${id}`, 'mfa-guess', 5, 300);
    const verified = await this.db.transaction(async (c) => {
      const r = await c.query<Credential>(
        'SELECT * FROM verifier.credentials WHERE id=$1 AND application_id=$2 FOR UPDATE',
        [id, identity.applicationId],
      );
      const credential = r.rows[0];
      if (!credential || activate === credential.active) return false;
      if (
        activate &&
        (!credential.enrollment_expires || credential.enrollment_expires.getTime() < Date.now())
      )
        return false;
      if (activate && credential.replaces_id) {
        const previous = await c.query(
          'SELECT id FROM verifier.credentials WHERE id=$1 AND application_id=$2 AND subject_hash=$3 AND active=true FOR UPDATE',
          [credential.replaces_id, identity.applicationId, credential.subject_hash],
        );
        if (!previous.rowCount) return false;
      }
      if (credential.active && /^[A-Za-z0-9_-]{22}$/.test(input.code)) {
        const consumed = await c.query(
          'UPDATE verifier.recovery_codes SET consumed_at=now() WHERE credential_id=$1 AND verifier=$2 AND consumed_at IS NULL RETURNING verifier',
          [id, hash(input.code)],
        );
        return !!consumed.rowCount;
      }
      const secret = await this.keys.decrypt(credential.envelope, identity.applicationId, id);
      const time = Math.floor(Date.now() / 1000);
      let accepted: bigint | null = null;
      if (credential.type === 'totp') {
        const step = BigInt(Math.floor(time / credential.period));
        for (const offset of [0n, -1n]) {
          const candidate = step + offset;
          if (candidate < 0n || candidate <= BigInt(credential.last_step)) continue;
          const code = await totp({ ...credential, secret }, Number(candidate) * credential.period);
          if (equal(code, input.code)) accepted = candidate;
        }
      } else {
        const counter = BigInt(credential.counter);
        for (let offset = 0n; offset <= 5n && counter + offset <= 0xffffffffffffffffn; offset++) {
          const candidate = counter + offset,
            code = await hotp(secret, candidate, credential.algorithm, credential.digits);
          if (equal(code, input.code) && accepted === null) accepted = candidate;
        }
      }
      if (accepted === null || (credential.type === 'hotp' && accepted === 0xffffffffffffffffn))
        return false;
      if (activate && credential.replaces_id)
        await c.query('DELETE FROM verifier.credentials WHERE id=$1', [credential.replaces_id]);
      if (credential.type === 'totp')
        await c.query('UPDATE verifier.credentials SET last_step=$2,active=true WHERE id=$1', [
          id,
          accepted.toString(),
        ]);
      else {
        await c.query('UPDATE verifier.credentials SET counter=$2,active=true WHERE id=$1', [
          id,
          (accepted + 1n).toString(),
        ]);
      }
      return true;
    });
    if (!verified) throw new UnauthorizedException();
    return { verified: true };
  }
}
@Controller('developer')
@UseGuards(SessionGuard)
export class DeveloperController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Security) private readonly security: Security,
  ) {}
  @Get('status') status() {
    return {
      enabled: this.db.config.MFA_ENABLED === 'true',
      trustModel: 'server-readable-verifier',
    };
  }
  @Get('applications/:id/keys') async keys(@Req() req: AuthRequest, @Param('id') id: string) {
    z.uuid().parse(id);
    const owner = await this.db.query(
      'SELECT id FROM verifier.applications WHERE id=$1 AND user_id=$2',
      [id, req.session.userId],
    );
    if (!owner.rowCount) throw new ForbiddenException();
    return (
      await this.db.query(
        'SELECT id,scopes,expires_at,revoked_at,last_used FROM verifier.api_keys WHERE application_id=$1 ORDER BY expires_at DESC LIMIT 100',
        [id],
      )
    ).rows;
  }
  @Get('applications/:id/credentials') async credentials(
    @Req() req: AuthRequest,
    @Param('id') id: string,
  ) {
    z.uuid().parse(id);
    const owner = await this.db.query(
      'SELECT id FROM verifier.applications WHERE id=$1 AND user_id=$2',
      [id, req.session.userId],
    );
    if (!owner.rowCount) throw new ForbiddenException();
    return (
      await this.db.query(
        'SELECT id,type,algorithm,digits,period,active,created_at FROM verifier.credentials WHERE application_id=$1 ORDER BY created_at DESC LIMIT 1000',
        [id],
      )
    ).rows;
  }
  @Post('applications') async create(@Req() req: AuthRequest, @Body() body: unknown) {
    if (this.db.config.MFA_ENABLED !== 'true') throw new ForbiddenException();
    recent(req.session);
    const input = z
      .object({ name: z.string().trim().min(1).max(64) })
      .strict()
      .parse(body);
    const id = randomUUID();
    await this.db.transaction(async (c) => {
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.session.userId]);
      const count = await c.query<{ count: string }>(
        'SELECT count(*) FROM verifier.applications WHERE user_id=$1',
        [req.session.userId],
      );
      if (Number(count.rows[0]!.count) >= 100) throw new PayloadTooLargeException();
      await c.query('INSERT INTO verifier.applications(id,user_id,name) VALUES($1,$2,$3)', [
        id,
        req.session.userId,
        input.name,
      ]);
    });
    return { id };
  }
  @Get('applications') async list(@Req() req: AuthRequest) {
    return (
      await this.db.query('SELECT id,name FROM verifier.applications WHERE user_id=$1', [
        req.session.userId,
      ])
    ).rows;
  }
  @Post('applications/:id/keys') async key(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    recent(req.session);
    z.uuid().parse(id);
    const input = z
      .object({
        scopes: z
          .array(z.enum(['enroll', 'verify']))
          .min(1)
          .max(2),
        days: z.number().int().min(1).max(90).default(30),
      })
      .strict()
      .parse(body);
    const app = await this.db.query(
      'SELECT id FROM verifier.applications WHERE id=$1 AND user_id=$2',
      [id, req.session.userId],
    );
    if (!app.rowCount) throw new ForbiddenException();
    const secret = `still_${token()}`,
      keyId = randomUUID();
    await this.db.transaction(async (c) => {
      await c.query('SELECT id FROM verifier.applications WHERE id=$1 FOR UPDATE', [id]);
      const count = await c.query<{ count: string }>(
        'SELECT count(*) FROM verifier.api_keys WHERE application_id=$1 AND revoked_at IS NULL AND expires_at>now()',
        [id],
      );
      if (Number(count.rows[0]!.count) >= 100) throw new PayloadTooLargeException();
      await c.query(
        "INSERT INTO verifier.api_keys(id,application_id,verifier,scopes,expires_at) VALUES($1,$2,$3,$4,now()+$5*interval '1 day')",
        [keyId, id, hash(secret), input.scopes, input.days],
      );
    });
    await this.security.event(req.session.userId, 'api-key.created', req.session.deviceId);
    return { id: keyId, key: secret };
  }
  @Delete('keys/:id') async revoke(@Req() req: AuthRequest, @Param('id') id: string) {
    recent(req.session);
    z.uuid().parse(id);
    const result = await this.db.query(
      'UPDATE verifier.api_keys k SET revoked_at=now() FROM verifier.applications a WHERE k.id=$1 AND a.id=k.application_id AND a.user_id=$2',
      [id, req.session.userId],
    );
    if (!result.rowCount) throw new ForbiddenException();
    return { ok: true };
  }
  @Post('credentials/:id/recovery-codes') async recovery(
    @Req() req: AuthRequest,
    @Param('id') id: string,
  ) {
    recent(req.session);
    z.uuid().parse(id);
    const codes = Array.from({ length: 10 }, () => randomBytes(16).toString('base64url'));
    await this.db.transaction(async (c) => {
      const credential = await c.query(
        'SELECT c.id FROM verifier.credentials c JOIN verifier.applications a ON a.id=c.application_id WHERE c.id=$1 AND a.user_id=$2 AND c.active=true FOR UPDATE',
        [id, req.session.userId],
      );
      if (!credential.rowCount) throw new ForbiddenException();
      await c.query('DELETE FROM verifier.recovery_codes WHERE credential_id=$1', [id]);
      for (const code of codes)
        await c.query('INSERT INTO verifier.recovery_codes(credential_id,verifier) VALUES($1,$2)', [
          id,
          hash(code),
        ]);
    });
    await this.security.event(req.session.userId, 'mfa-recovery.created', req.session.deviceId);
    return { codes };
  }
  @Delete('credentials/:id') async disable(@Req() req: AuthRequest, @Param('id') id: string) {
    recent(req.session);
    z.uuid().parse(id);
    const result = await this.db.query(
      'DELETE FROM verifier.credentials c USING verifier.applications a WHERE c.id=$1 AND a.id=c.application_id AND a.user_id=$2',
      [id, req.session.userId],
    );
    if (!result.rowCount) throw new ForbiddenException();
    return { ok: true };
  }
}
@Controller('mfa')
export class MfaController {
  constructor(@Inject(MfaService) private readonly service: MfaService) {}
  @Post('enrollments') async enroll(@Req() req: Request, @Body() body: unknown) {
    return this.service.enroll(body, await this.service.authorize(req, 'enroll'));
  }
  @Post(':id/confirm') async confirm(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.verify(id, body, await this.service.authorize(req, 'enroll'), true);
  }
  @Post(':id/verify') async verify(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.verify(id, body, await this.service.authorize(req, 'verify'));
  }
}
