import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Post,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
  Param,
  ForbiddenException,
} from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type AuthenticatorTransport,
} from '@simplewebauthn/server';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Database } from './database.js';
import {
  Security,
  SessionGuard,
  cookie,
  hash,
  token,
  setCookie,
  recent,
  type AuthRequest,
  type Session,
} from './security.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Security) private readonly security: Security,
  ) {}
  async options(
    kind: 'register' | 'login' | 'add' | 'reauth',
    request: Request,
    response: Response,
    session?: Session,
  ) {
    await this.security.limit(request.ip ?? 'unknown', 'auth-challenge', 30, 60);
    const userId = session?.userId ?? (kind === 'register' ? randomUUID() : null);
    const passkeys = userId
      ? (
          await this.db.query<{ id: string; transports: AuthenticatorTransport[] }>(
            'SELECT id,transports FROM passkeys WHERE user_id=$1',
            [userId],
          )
        ).rows
      : [];
    if (kind === 'add' && session) recent(session);
    const options =
      kind === 'register' || kind === 'add'
        ? await generateRegistrationOptions({
            rpName: 'Still',
            rpID: this.db.config.RP_ID,
            userName: `Still ${userId!.slice(0, 8)}`,
            userID: new TextEncoder().encode(userId!),
            attestationType: 'none',
            authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
            excludeCredentials: passkeys.map((p) => ({ id: p.id, transports: p.transports })),
          })
        : await generateAuthenticationOptions({
            rpID: this.db.config.RP_ID,
            userVerification: 'required',
            ...(kind === 'reauth'
              ? { allowCredentials: passkeys.map((p) => ({ id: p.id, transports: p.transports })) }
              : {}),
          });
    const challengeToken = token();
    await this.db.query(
      "INSERT INTO challenges(token_hash,kind,challenge,user_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '3 minutes')",
      [hash(challengeToken), kind, options.challenge, userId],
    );
    setCookie(response, '__Host-still-challenge', challengeToken, 180000);
    return options;
  }
  async verify(request: Request, response: Response, body: unknown, session?: Session) {
    await this.security.limit(request.ip ?? 'unknown', 'auth-verify', 20, 60);
    const credential = z
      .object({
        response: z.object({ id: z.string().min(1).max(2048) }).passthrough(),
        name: z.string().trim().min(1).max(64).default('My passkey'),
        deviceName: z.string().trim().min(1).max(64).default('This browser'),
      })
      .strict()
      .parse(body);
    const challengeCookie = cookie(request, '__Host-still-challenge');
    if (!challengeCookie) throw new UnauthorizedException();
    const challenge = (
      await this.db.query<{
        kind: 'register' | 'login' | 'add' | 'reauth';
        challenge: string;
        user_id: string | null;
      }>(
        'DELETE FROM challenges WHERE token_hash=$1 AND expires_at>now() RETURNING kind,challenge,user_id',
        [hash(challengeCookie)],
      )
    ).rows[0];
    setCookie(response, '__Host-still-challenge', '', 0);
    if (!challenge) throw new UnauthorizedException();
    if (
      ['add', 'reauth'].includes(challenge.kind) &&
      (!session || challenge.user_id !== session.userId)
    )
      throw new UnauthorizedException();
    let userId: string;
    if (challenge.kind === 'register' || challenge.kind === 'add') {
      let verified;
      try {
        verified = await verifyRegistrationResponse({
          response: credential.response as unknown as RegistrationResponseJSON,
          expectedChallenge: challenge.challenge,
          expectedOrigin: this.db.config.APP_ORIGIN,
          expectedRPID: this.db.config.RP_ID,
          requireUserVerification: true,
        });
      } catch {
        throw new UnauthorizedException();
      }
      if (!verified.verified || !verified.registrationInfo) throw new UnauthorizedException();
      const info = verified.registrationInfo;
      userId = challenge.user_id!;
      await this.db.transaction(async (client) => {
        if (challenge.kind === 'register')
          await client.query('INSERT INTO users(id) VALUES($1)', [userId]);
        else {
          const exists = await client.query(
            'SELECT token_hash FROM sessions WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',
            [session!.tokenHash],
          );
          if (!exists.rowCount) throw new UnauthorizedException();
        }
        await client.query(
          'INSERT INTO passkeys(id,user_id,public_key,counter,transports,name,backup_eligible,backed_up) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            info.credential.id,
            userId,
            Buffer.from(info.credential.publicKey),
            info.credential.counter,
            JSON.stringify(info.credential.transports ?? []),
            credential.name,
            info.credentialDeviceType === 'multiDevice',
            info.credentialBackedUp,
          ],
        );
      });
      await this.security.event(userId, 'passkey.added', session?.deviceId);
      if (challenge.kind === 'add') return { ok: true };
    } else {
      const p = (
        await this.db.query<{
          id: string;
          user_id: string;
          public_key: Buffer;
          counter: string;
          transports: AuthenticatorTransport[];
        }>('SELECT * FROM passkeys WHERE id=$1', [credential.response.id])
      ).rows[0];
      if (!p || (challenge.kind === 'reauth' && p.user_id !== session?.userId))
        throw new UnauthorizedException();
      let verified;
      try {
        verified = await verifyAuthenticationResponse({
          response: credential.response as unknown as AuthenticationResponseJSON,
          expectedChallenge: challenge.challenge,
          expectedOrigin: this.db.config.APP_ORIGIN,
          expectedRPID: this.db.config.RP_ID,
          credential: {
            id: p.id,
            publicKey: new Uint8Array(p.public_key),
            counter: Number(p.counter),
            transports: p.transports,
          },
          requireUserVerification: true,
        });
      } catch {
        throw new UnauthorizedException();
      }
      if (!verified.verified) throw new UnauthorizedException();
      const result = await this.db.query(
        'UPDATE passkeys SET counter=$1,backed_up=$2 WHERE id=$3 AND counter=$4',
        [
          verified.authenticationInfo.newCounter,
          verified.authenticationInfo.credentialBackedUp,
          p.id,
          p.counter,
        ],
      );
      if (!result.rowCount) throw new UnauthorizedException();
      userId = p.user_id;
      if (challenge.kind === 'reauth') {
        await this.db.query('UPDATE sessions SET verified_at=now() WHERE token_hash=$1', [
          session!.tokenHash,
        ]);
        await this.security.event(userId, 'session.reauthenticated', session!.deviceId);
        return { ok: true };
      }
    }
    const sessionToken = token(),
      deviceId = randomUUID();
    await this.db.transaction(async (client) => {
      const previous = cookie(request, '__Host-still-session');
      if (previous)
        await client.query('DELETE FROM sessions WHERE token_hash=$1', [hash(previous)]);
      await client.query('INSERT INTO devices(id,user_id,name) VALUES($1,$2,$3)', [
        deviceId,
        userId,
        credential.deviceName,
      ]);
      await client.query(
        "INSERT INTO sessions(token_hash,user_id,device_id,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
        [hash(sessionToken), userId, deviceId],
      );
    });
    setCookie(response, '__Host-still-session', sessionToken, 7 * 86400000);
    await this.security.event(userId, 'session.created', deviceId);
    return { ok: true, userId, deviceId };
  }
}
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Database) private readonly db: Database,
    @Inject(Security) private readonly security: Security,
  ) {}
  @Post('register/options') register(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.options('register', req, res);
  }
  @Post('login/options') login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.options('login', req, res);
  }
  @Post('verify') verify(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return this.auth.verify(req, res, body);
  }
  @Post('passkeys/options') @UseGuards(SessionGuard) add(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.options('add', req, res, req.session);
  }
  @Post('reauth/options') @UseGuards(SessionGuard) reauth(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.options('reauth', req, res, req.session);
  }
  @Post('protected/verify') @UseGuards(SessionGuard) protectedVerify(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return this.auth.verify(req, res, body, req.session);
  }
  @Get('me') @UseGuards(SessionGuard) async me(@Req() req: AuthRequest) {
    const s = req.session;
    const [devices, passkeys, events] = await Promise.all([
      this.db.query(
        'SELECT id,name,revoked_at,created_at,last_seen FROM devices WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',
        [s.userId],
      ),
      this.db.query(
        'SELECT id,name,created_at,backup_eligible,backed_up FROM passkeys WHERE user_id=$1',
        [s.userId],
      ),
      this.db.query(
        'SELECT kind,created_at FROM security_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
        [s.userId],
      ),
    ]);
    return {
      userId: s.userId,
      deviceId: s.deviceId,
      devices: devices.rows,
      passkeys: passkeys.rows,
      events: events.rows,
    };
  }
  @Post('logout') @UseGuards(SessionGuard) async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [req.session.tokenHash]);
    setCookie(res, '__Host-still-session', '', 0);
    return { ok: true };
  }
  @Post('logout-all') @UseGuards(SessionGuard) async logoutAll(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    recent(req.session);
    await this.db.query('DELETE FROM sessions WHERE user_id=$1', [req.session.userId]);
    setCookie(res, '__Host-still-session', '', 0);
    await this.security.event(req.session.userId, 'sessions.revoked');
    return { ok: true };
  }
  @Delete('passkeys/:id') @UseGuards(SessionGuard) async removePasskey(
    @Req() req: AuthRequest,
    @Param('id') id: string,
  ) {
    recent(req.session);
    if (id.length > 2048) throw new BadRequestException();
    await this.db.transaction(async (c) => {
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.session.userId]);
      const count = await c.query('SELECT id FROM passkeys WHERE user_id=$1', [req.session.userId]);
      if (count.rowCount! <= 1) throw new ForbiddenException();
      const removed = await c.query('DELETE FROM passkeys WHERE id=$1 AND user_id=$2', [
        id,
        req.session.userId,
      ]);
      if (!removed.rowCount) throw new BadRequestException();
    });
    await this.security.event(req.session.userId, 'passkey.removed', req.session.deviceId);
    return { ok: true };
  }
  @Post('devices/:id/revoke') @UseGuards(SessionGuard) async revoke(
    @Req() req: AuthRequest,
    @Param('id') id: string,
  ) {
    recent(req.session);
    z.uuid().parse(id);
    await this.db.transaction(async (c) => {
      const d = await c.query(
        'UPDATE devices SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id',
        [id, req.session.userId],
      );
      if (!d.rowCount) throw new BadRequestException();
      await c.query('DELETE FROM sessions WHERE device_id=$1', [id]);
      await c.query('DELETE FROM key_envelopes WHERE recipient_id=$1', [id]);
    });
    await this.security.event(req.session.userId, 'device.revoked', req.session.deviceId);
    return { ok: true };
  }
  @Delete('account') @UseGuards(SessionGuard) async removeAccount(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    recent(req.session);
    await this.db.query('DELETE FROM users WHERE id=$1', [req.session.userId]);
    setCookie(res, '__Host-still-session', '', 0);
    return { ok: true };
  }
}
