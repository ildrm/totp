import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Database } from './database.js';
export type Session = { userId: string; deviceId: string; tokenHash: string; verifiedAt: Date };
export type AuthRequest = Request & { session: Session };
export const token = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function cookie(request: Request, name: string): string | undefined {
  const raw = request.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : undefined;
}
export function setCookie(response: Response, name: string, value: string, maxAge: number) {
  response.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
}
export function recent(session: Session): void {
  if (Date.now() - session.verifiedAt.getTime() > 300000)
    throw new ForbiddenException('Reauthenticate with a passkey before continuing.');
}
@Injectable()
export class Security {
  private readonly rateKey: string;
  constructor(@Inject(Database) private readonly db: Database) {
    this.rateKey = db.config.RATE_LIMIT_KEY ?? randomBytes(32).toString('hex');
  }
  async limit(identity: string, action: string, maximum = 20, window = 60): Promise<void> {
    const bucket = createHmac('sha256', this.rateKey).update(`${action}:${identity}`).digest('hex');
    const r = await this.db.query<{ attempts: number }>(
      `INSERT INTO rate_limits(bucket,attempts,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.attempts+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING attempts`,
      [bucket, window],
    );
    if (r.rows[0]!.attempts > maximum) throw new HttpException('Try again later.', 429);
  }
  async event(userId: string, kind: string, deviceId?: string) {
    await this.db.query(
      'INSERT INTO security_events(id,user_id,kind,device_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), userId, kind, deviceId ?? null],
    );
  }
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(Database) private readonly db: Database) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const value = cookie(request, '__Host-still-session');
    if (!value) throw new UnauthorizedException();
    const tokenHash = hash(value);
    const result = await this.db.query<{ user_id: string; device_id: string; verified_at: Date }>(
      `UPDATE sessions s SET last_seen=now() FROM devices d WHERE s.token_hash=$1 AND d.id=s.device_id AND d.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen>now()-interval '1 hour' RETURNING s.user_id,s.device_id,s.verified_at`,
      [tokenHash],
    );
    const s = result.rows[0];
    if (!s) throw new UnauthorizedException();
    request.session = {
      userId: s.user_id,
      deviceId: s.device_id,
      tokenHash,
      verifiedAt: s.verified_at,
    };
    return true;
  }
}
@Catch()
export class SafeErrors implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    let status = 500,
      message = 'The request could not be completed.';
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message =
        status === 401
          ? 'Authentication required.'
          : status === 403
            ? 'Access denied or reauthentication required.'
            : status === 409
              ? 'Conflict.'
              : status === 429
                ? 'Try again later.'
                : status === 404
                  ? 'Not found.'
                  : 'Invalid request.';
    } else if (exception instanceof Error && exception.name === 'ZodError') {
      status = 400;
      message = 'Invalid request.';
    }
    response.status(status).json({ statusCode: status, message });
  }
}
