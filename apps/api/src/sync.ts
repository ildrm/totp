import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { z } from 'zod';
import {
  can,
  envelopeSchema,
  pairingSchema,
  syncOperationSchema,
  type Role,
  type SyncOperation,
} from '../../../packages/core/src/index.js';
import type { PoolClient } from 'pg';
import { Database } from './database.js';
import { Security, SessionGuard, recent, type AuthRequest, type Session } from './security.js';
const createSchema = z
  .object({ id: z.uuid(), keyId: z.uuid(), shared: z.boolean().default(false) })
  .strict();
type VaultAccess = {
  id: string;
  role: Role;
  revision: string;
  epoch: number;
  key_id: string;
  owner_id: string;
  storage_bytes: string;
};
@Injectable()
export class SyncService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Security) private readonly security: Security,
  ) {}
  async access(
    vaultId: string,
    session: Session,
    action: Parameters<typeof can>[1],
    client?: PoolClient,
  ): Promise<VaultAccess> {
    z.uuid().parse(vaultId);
    const sql =
      'SELECT v.*,m.role FROM vaults v JOIN memberships m ON m.vault_id=v.id JOIN devices d ON d.id=$3 AND d.user_id=m.user_id AND d.revoked_at IS NULL WHERE v.id=$1 AND m.user_id=$2';
    const values = [vaultId, session.userId, session.deviceId];
    const result = client
      ? await client.query<VaultAccess>(sql, values)
      : await this.db.query<VaultAccess>(sql, values);
    const vault = result.rows[0];
    if (!vault || !can(vault.role, action)) throw new ForbiddenException();
    return vault;
  }
  async create(body: unknown, session: Session) {
    const data = createSchema.parse(body);
    recent(session);
    await this.db.transaction(async (c) => {
      const exists = await c.query<{ owner_id: string; key_id: string; shared: boolean }>(
        'SELECT owner_id,key_id,shared FROM vaults WHERE id=$1 FOR UPDATE',
        [data.id],
      );
      if (exists.rows[0]) {
        if (
          exists.rows[0].owner_id !== session.userId ||
          exists.rows[0].key_id !== data.keyId ||
          exists.rows[0].shared !== data.shared
        )
          throw new ForbiddenException();
        return;
      }
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const owned = await c.query<{ count: string }>(
        'SELECT count(*) FROM vaults WHERE owner_id=$1',
        [session.userId],
      );
      if (Number(owned.rows[0]!.count) >= 50) throw new PayloadTooLargeException();
      await c.query('INSERT INTO vaults(id,owner_id,key_id,shared) VALUES($1,$2,$3,$4)', [
        data.id,
        session.userId,
        data.keyId,
        data.shared,
      ]);
      await c.query('INSERT INTO memberships(vault_id,user_id,role) VALUES($1,$2,$3)', [
        data.id,
        session.userId,
        'owner',
      ]);
    });
    await this.security.event(session.userId, 'sync.enabled', session.deviceId);
    return { ok: true };
  }
  async push(body: unknown, session: Session) {
    const input = syncOperationSchema.parse(body);
    await this.security.limit(session.userId, 'sync-write', 300, 60);
    return this.db.transaction(async (c) => {
      // Lock the vault before the access check, serializing writes and membership changes.
      await c.query('SELECT id FROM vaults WHERE id=$1 FOR UPDATE', [input.vaultId]);
      const vault = await this.access(input.vaultId, session, 'write', c);
      if (
        input.proof.keyId !== vault.key_id ||
        (input.envelope && input.envelope.keyId !== vault.key_id)
      )
        throw new ConflictException();
      const previous = (
        await c.query('SELECT * FROM sync_operations WHERE operation_id=$1', [input.operationId])
      ).rows[0];
      if (previous) {
        if (
          previous.vault_id !== input.vaultId ||
          previous.device_id !== session.deviceId ||
          previous.record_id !== input.recordId ||
          Number(previous.base_revision) !== input.baseRevision ||
          previous.tombstone !== input.tombstone ||
          JSON.stringify(previous.proof) !== JSON.stringify(input.proof) ||
          JSON.stringify(previous.envelope) !== JSON.stringify(input.envelope)
        ) {
          // JSONB key order is normalized; compare parsed fields instead of insertion order.
          const equal =
            previous.vault_id === input.vaultId &&
            previous.device_id === session.deviceId &&
            previous.record_id === input.recordId &&
            Number(previous.base_revision) === input.baseRevision &&
            previous.tombstone === input.tombstone &&
            Object.keys(input.proof).every(
              (k) => previous.proof[k] === input.proof[k as keyof typeof input.proof],
            ) &&
            ((!previous.envelope && !input.envelope) ||
              (previous.envelope &&
                input.envelope &&
                Object.keys(input.envelope).every(
                  (k) =>
                    previous.envelope[k] ===
                    input.envelope![k as keyof NonNullable<SyncOperation['envelope']>],
                )));
          if (!equal) throw new ConflictException();
        }
        return { revision: Number(previous.revision), conflict: previous.conflict };
      }
      const head = (
        await c.query<{ revision: string }>(
          'SELECT revision FROM record_heads WHERE vault_id=$1 AND record_id=$2',
          [input.vaultId, input.recordId],
        )
      ).rows[0];
      const current = Number(vault.revision);
      if (input.baseRevision > current) throw new ConflictException();
      if (current >= Number.MAX_SAFE_INTEGER) throw new ConflictException();
      const conflict = Number(head?.revision ?? 0) !== input.baseRevision,
        revision = current + 1;
      const count = (
        await c.query<{ count: string }>('SELECT count(*) FROM sync_operations WHERE vault_id=$1', [
          input.vaultId,
        ])
      ).rows[0]!;
      if (Number(count.count) >= 100000)
        throw new ConflictException('Vault history limit reached.');
      const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8') + 256;
      if (Number(vault.storage_bytes) + bytes > 100 * 1024 * 1024)
        throw new PayloadTooLargeException();
      if (!head) {
        const heads = await c.query<{ count: string }>(
          'SELECT count(*) FROM record_heads WHERE vault_id=$1',
          [input.vaultId],
        );
        if (Number(heads.rows[0]!.count) >= 10000) throw new PayloadTooLargeException();
      }
      await c.query('UPDATE vaults SET revision=$2,storage_bytes=storage_bytes+$3 WHERE id=$1', [
        input.vaultId,
        revision,
        bytes,
      ]);
      await c.query(
        'INSERT INTO sync_operations(operation_id,vault_id,record_id,device_id,base_revision,revision,envelope,tombstone,conflict,proof) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          input.operationId,
          input.vaultId,
          input.recordId,
          session.deviceId,
          input.baseRevision,
          revision,
          input.envelope ? JSON.stringify(input.envelope) : null,
          input.tombstone,
          conflict,
          JSON.stringify(input.proof),
        ],
      );
      if (!conflict)
        await c.query(
          'INSERT INTO record_heads(vault_id,record_id,revision) VALUES($1,$2,$3) ON CONFLICT(vault_id,record_id) DO UPDATE SET revision=EXCLUDED.revision',
          [input.vaultId, input.recordId, revision],
        );
      return { revision, conflict };
    });
  }
  async pull(vaultId: string, after: number, session: Session) {
    const vault = await this.access(vaultId, session, 'read');
    if (after > Number(vault.revision)) throw new ConflictException();
    const operations = await this.db.query(
      "SELECT operation_id,record_id,revision,base_revision,envelope,tombstone,conflict,proof FROM sync_operations WHERE vault_id=$1 AND revision>$2 AND revision<=$3 AND proof->>'keyId'=$4 ORDER BY revision LIMIT 500",
      [vaultId, after, vault.revision, vault.key_id],
    );
    return {
      revision: Number(vault.revision),
      epoch: vault.epoch,
      keyId: vault.key_id,
      operations: operations.rows.map((o) => ({
        ...o,
        revision: Number(o.revision),
        base_revision: Number(o.base_revision),
      })),
      hasMore: operations.rows.length === 500,
    };
  }
}
@Controller('vaults')
@UseGuards(SessionGuard)
export class SyncController {
  constructor(
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(Database) private readonly db: Database,
    @Inject(Security) private readonly security: Security,
  ) {}
  @Post() create(@Body() body: unknown, @Req() req: AuthRequest) {
    return this.sync.create(body, req.session);
  }
  @Get() async list(@Req() req: AuthRequest) {
    return (
      await this.db.query(
        'SELECT v.id,v.shared,v.epoch,v.key_id,m.role FROM vaults v JOIN memberships m ON m.vault_id=v.id WHERE m.user_id=$1',
        [req.session.userId],
      )
    ).rows;
  }
  @Post('operations') push(@Body() body: unknown, @Req() req: AuthRequest) {
    return this.sync.push(body, req.session);
  }
  @Get(':id/operations') pull(
    @Param('id') id: string,
    @Query('after') after: string | undefined,
    @Req() req: AuthRequest,
  ) {
    return this.sync.pull(
      id,
      z.coerce
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .parse(after ?? 0),
      req.session,
    );
  }
  @Delete(':id') async remove(@Param('id') id: string, @Req() req: AuthRequest) {
    recent(req.session);
    await this.db.transaction(async (c) => {
      await c.query('SELECT id FROM vaults WHERE id=$1 FOR UPDATE', [id]);
      await this.sync.access(id, req.session, 'delete', c);
      await c.query('DELETE FROM vaults WHERE id=$1', [id]);
    });
    await this.security.event(req.session.userId, 'cloud-vault.deleted', req.session.deviceId);
    return { ok: true };
  }
  @Get(':id/members') async members(@Param('id') id: string, @Req() req: AuthRequest) {
    await this.sync.access(id, req.session, 'read');
    return (await this.db.query('SELECT user_id,role FROM memberships WHERE vault_id=$1', [id]))
      .rows;
  }
  @Post(':id/members') async invite(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    recent(req.session);
    const input = z
      .object({ userId: z.uuid(), role: z.enum(['admin', 'member', 'viewer']) })
      .strict()
      .parse(body);
    await this.db.transaction(async (c) => {
      await c.query('SELECT id FROM vaults WHERE id=$1 FOR UPDATE', [id]);
      const vault = await this.sync.access(id, req.session, 'invite', c);
      const shared = await c.query('SELECT shared FROM vaults WHERE id=$1', [id]);
      if (!shared.rows[0]?.shared || (input.role === 'admin' && vault.role !== 'owner'))
        throw new ForbiddenException();
      const count = await c.query<{ count: string }>(
        'SELECT count(*) FROM memberships WHERE vault_id=$1',
        [id],
      );
      if (Number(count.rows[0]!.count) >= 100) throw new PayloadTooLargeException();
      await c.query('INSERT INTO memberships(vault_id,user_id,role) VALUES($1,$2,$3)', [
        id,
        input.userId,
        input.role,
      ]);
    });
    await this.security.event(req.session.userId, 'membership.added', req.session.deviceId);
    return { ok: true };
  }
  @Post(':id/rotate') async rotate(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    recent(req.session);
    const input = z
      .object({
        removeUserId: z.uuid().optional(),
        newKeyId: z.uuid(),
        operations: z.array(syncOperationSchema).max(10000),
        envelopes: z
          .array(
            z
              .object({ recipientId: z.uuid(), context: pairingSchema, envelope: envelopeSchema })
              .strict(),
          )
          .max(1000),
      })
      .strict()
      .parse(body);
    await this.db.transaction(async (c) => {
      await c.query('SELECT id FROM vaults WHERE id=$1 FOR UPDATE', [id]);
      const vault = await this.sync.access(id, req.session, 'remove', c);
      if (input.newKeyId === vault.key_id || input.removeUserId === vault.owner_id)
        throw new ForbiddenException();
      const bytes =
        Buffer.byteLength(JSON.stringify(input), 'utf8') + 256 * input.operations.length;
      const count = await c.query<{ count: string }>(
        'SELECT count(*) FROM sync_operations WHERE vault_id=$1',
        [id],
      );
      if (
        Number(vault.storage_bytes) + bytes > 100 * 1024 * 1024 ||
        Number(count.rows[0]!.count) + input.operations.length > 100000 ||
        Number(vault.revision) + input.operations.length > Number.MAX_SAFE_INTEGER
      )
        throw new PayloadTooLargeException();
      const role = input.removeUserId
        ? (
            await c.query('SELECT role FROM memberships WHERE vault_id=$1 AND user_id=$2', [
              id,
              input.removeUserId,
            ])
          ).rows[0]?.role
        : null;
      if (role === 'admin' && vault.role !== 'owner') throw new ForbiddenException();
      const heads = (
        await c.query(
          'SELECT h.record_id FROM record_heads h JOIN sync_operations o ON o.vault_id=h.vault_id AND o.revision=h.revision WHERE h.vault_id=$1 AND o.tombstone=false',
          [id],
        )
      ).rows;
      const newIds = new Set(input.operations.map((e) => e.recordId));
      if (
        newIds.size !== input.operations.length ||
        heads.some((h) => !newIds.has(h.record_id)) ||
        input.operations.some(
          (e) =>
            e.vaultId !== id ||
            e.proof.keyId !== input.newKeyId ||
            e.baseRevision !== 0 ||
            e.tombstone ||
            !e.envelope ||
            e.envelope.keyId !== input.newKeyId,
        )
      )
        throw new ConflictException();
      if (input.removeUserId)
        await c.query('DELETE FROM memberships WHERE vault_id=$1 AND user_id=$2', [
          id,
          input.removeUserId,
        ]);
      await c.query('UPDATE vaults SET key_id=$2,epoch=epoch+1 WHERE id=$1', [id, input.newKeyId]);
      await c.query('DELETE FROM key_envelopes WHERE vault_id=$1', [id]);
      for (const e of input.envelopes) {
        const d = await c.query(
          'SELECT d.id FROM devices d JOIN memberships m ON m.user_id=d.user_id WHERE m.vault_id=$1 AND d.id=$2 AND d.revoked_at IS NULL',
          [id, e.recipientId],
        );
        if (
          !d.rowCount ||
          e.context.epoch !== vault.epoch + 1 ||
          e.context.senderId !== req.session.deviceId ||
          e.context.recipientId !== e.recipientId ||
          e.context.vaultId !== id
        )
          throw new ForbiddenException();
        await c.query(
          'INSERT INTO key_envelopes(vault_id,recipient_id,sender_id,epoch,context,envelope) VALUES($1,$2,$3,$4,$5,$6)',
          [
            id,
            e.recipientId,
            req.session.deviceId,
            vault.epoch + 1,
            JSON.stringify(e.context),
            JSON.stringify(e.envelope),
          ],
        );
      }
      let revision = Number(vault.revision);
      for (const e of input.operations) {
        revision++;
        await c.query(
          'INSERT INTO sync_operations(operation_id,vault_id,record_id,device_id,base_revision,revision,envelope,tombstone,conflict,proof) VALUES($1,$2,$3,$4,$5,$6,$7,false,false,$8)',
          [
            e.operationId,
            id,
            e.recordId,
            req.session.deviceId,
            e.baseRevision,
            revision,
            JSON.stringify(e.envelope),
            JSON.stringify(e.proof),
          ],
        );
        await c.query(
          'INSERT INTO record_heads(vault_id,record_id,revision) VALUES($1,$2,$3) ON CONFLICT(vault_id,record_id) DO UPDATE SET revision=EXCLUDED.revision',
          [id, e.recordId, revision],
        );
      }
      await c.query('UPDATE vaults SET revision=$2,storage_bytes=storage_bytes+$3 WHERE id=$1', [
        id,
        revision,
        bytes,
      ]);
    });
    await this.security.event(req.session.userId, 'vault.rotated', req.session.deviceId);
    return { ok: true };
  }
}
