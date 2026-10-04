import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { envelopeSchema, pairingSchema } from '../../../packages/core/src/index.js';
import { Database } from './database.js';
import { SyncService } from './sync.js';
import { SessionGuard, Security, recent, type AuthRequest } from './security.js';
const publicKeySchema = pairingSchema.shape.publicKey;
@Controller('pairings')
@UseGuards(SessionGuard)
export class PairingController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(Security) private readonly security: Security,
  ) {}
  @Post() async request(@Body() body: unknown, @Req() req: AuthRequest) {
    recent(req.session);
    await this.security.limit(req.session.userId, 'pairing', 5, 60);
    const input = z.object({ vaultId: z.uuid(), publicKey: publicKeySchema }).strict().parse(body);
    await this.sync.access(input.vaultId, req.session, 'read');
    const id = randomUUID(),
      expiresAt = Date.now() + 180000;
    await this.db.query(
      'INSERT INTO pairings(id,user_id,recipient_id,vault_id,public_key,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
      [
        id,
        req.session.userId,
        req.session.deviceId,
        input.vaultId,
        JSON.stringify(input.publicKey),
        new Date(expiresAt),
      ],
    );
    await this.db.query('UPDATE devices SET public_key=$2 WHERE id=$1', [
      req.session.deviceId,
      JSON.stringify(input.publicKey),
    ]);
    await this.security.event(req.session.userId, 'pairing.requested', req.session.deviceId);
    return {
      version: 1,
      transactionId: id,
      vaultId: input.vaultId,
      recipientId: req.session.deviceId,
      publicKey: input.publicKey,
      expiresAt,
    };
  }
  @Get(':id') async status(@Param('id') id: string, @Req() req: AuthRequest) {
    z.uuid().parse(id);
    const result = await this.db.query(
      'SELECT id,recipient_id,vault_id,public_key,expires_at,approved_at,context,envelope FROM pairings WHERE id=$1 AND recipient_id=$2 AND user_id=$3 AND expires_at>now()',
      [id, req.session.deviceId, req.session.userId],
    );
    const pairing = result.rows[0];
    if (!pairing) throw new ForbiddenException();
    return pairing;
  }
  @Post(':id/approve') async approve(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    recent(req.session);
    z.uuid().parse(id);
    const input = z
      .object({
        context: pairingSchema,
        envelope: envelopeSchema,
        senderPublicKey: publicKeySchema,
      })
      .strict()
      .parse(body);
    await this.db.transaction(async (c) => {
      const result = await c.query(
        'SELECT * FROM pairings WHERE id=$1 AND expires_at>now() AND approved_at IS NULL FOR UPDATE',
        [id],
      );
      const p = result.rows[0];
      if (!p) throw new ConflictException();
      const vault = await this.sync.access(p.vault_id, req.session, 'read', c);
      const context = input.context;
      if (
        p.recipient_id === req.session.deviceId ||
        context.transactionId !== id ||
        context.senderId !== req.session.deviceId ||
        context.recipientId !== p.recipient_id ||
        context.vaultId !== p.vault_id ||
        context.epoch !== vault.epoch ||
        context.expiresAt !== new Date(p.expires_at).getTime() ||
        context.publicKey.x !== p.public_key.x ||
        context.publicKey.y !== p.public_key.y
      )
        throw new ForbiddenException();
      const recipient = await c.query(
        'SELECT d.id FROM devices d JOIN memberships m ON m.user_id=d.user_id WHERE d.id=$1 AND d.revoked_at IS NULL AND m.vault_id=$2',
        [p.recipient_id, p.vault_id],
      );
      if (!recipient.rowCount) throw new ForbiddenException();
      if (
        input.envelope.vaultId !== p.vault_id ||
        input.envelope.keyId !== id ||
        input.envelope.recordId !== `${req.session.deviceId}:${p.recipient_id}:${vault.epoch}`
      )
        throw new ForbiddenException();
      await c.query('UPDATE devices SET public_key=$2 WHERE id=$1', [
        req.session.deviceId,
        JSON.stringify(input.senderPublicKey),
      ]);
      await c.query('UPDATE pairings SET approved_at=now(),context=$2,envelope=$3 WHERE id=$1', [
        id,
        JSON.stringify({ ...context, senderPublicKey: input.senderPublicKey }),
        JSON.stringify(input.envelope),
      ]);
      await c.query(
        'INSERT INTO key_envelopes(vault_id,recipient_id,sender_id,epoch,context,envelope) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(vault_id,recipient_id,epoch) DO UPDATE SET context=EXCLUDED.context,envelope=EXCLUDED.envelope',
        [
          p.vault_id,
          p.recipient_id,
          req.session.deviceId,
          vault.epoch,
          JSON.stringify({ ...context, senderPublicKey: input.senderPublicKey }),
          JSON.stringify(input.envelope),
        ],
      );
    });
    await this.security.event(req.session.userId, 'pairing.approved', req.session.deviceId);
    return { ok: true };
  }
}
