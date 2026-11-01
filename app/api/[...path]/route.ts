import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { currentUser, rateLimit } from '@/lib/auth';
import { db, one } from '@/lib/db';
import { HttpError, assert } from '@/lib/errors';
import {
  actorFor,
  master,
  visibleRecords,
  readRecord,
  canReadAttachment,
  characterIds,
  type Actor,
} from '@/lib/policy';
import * as service from '@/lib/service';
import { validateFile, putObject, readObject, signedObject, proxyObject } from '@/lib/storage';
import { exportCampaign } from '@/lib/backup';
import { storageStatus, checkDrive, backupToDrive } from '@/lib/drive-backup';
import { characterChoices, claimCharacter } from '@/lib/character-selection';
import * as community from '@/lib/community';
import * as commerce from '@/lib/commerce';
import {
  integrationFromHeader,
  checkIntegration,
  createIntegration,
  listIntegrations,
  revokeIntegration,
} from '@/lib/integrations';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const uuid = (s: string) => z.uuid().parse(s);
async function dispatch(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const integration = await integrationFromHeader(req.headers.get('authorization'));
    const user = integration ? { id: integration.userId } : await currentUser();
    assert(user, 401, 'Iniciá sesión para continuar');
    const { path: p } = await params;
    if (integration) {
      checkIntegration(integration, req.method, p);
      await rateLimit(`integration:${integration.id}`, 60);
    }
    const method = req.method;
    if (method !== 'GET') {
      const origin = req.headers.get('origin');
      if (!integration)
        assert(
          origin && origin === new URL(process.env.NEXTAUTH_URL || req.url).origin,
          403,
          'Origen no autorizado',
        );
      await rateLimit(`write:${user.id}`, 80);
      assert(
        Number(req.headers.get('content-length') || 0) <= 4 * 1024 * 1024,
        413,
        'Solicitud demasiado grande',
      );
    }
    const conn = await db();
    if (p.length === 1 && p[0] === 'campaigns' && method === 'GET')
      return json(
        (
          await conn.query(
            'SELECT c.id,c.name,c.group_name,c.demo,m.role FROM campaigns c JOIN members m ON m.campaign_id=c.id WHERE m.user_id=$1 AND m.active=true ORDER BY c.demo,c.name',
            [user.id],
          )
        ).rows,
      );
    assert(p[0] === 'campaigns' && p[1], 404);
    const campaignId = uuid(p[1]);
    let a = await actorFor(user.id, campaignId);
    const preview = req.nextUrl.searchParams.get('as');
    if (preview) {
      master(a);
      assert(method === 'GET', 403, 'La vista de personaje es de solo lectura');
      await actorFor(user.id, campaignId, uuid(preview));
      a = { ...a, role: 'player', characterId: preview, preview: true };
    }
    const section = p[2],
      id = p[3];
    if (section === 'overview' && method === 'GET') {
      const campaign = await one(
        'SELECT id,name,group_name,world_time,demo FROM campaigns WHERE id=$1',
        [campaignId],
      );
      const records = await visibleRecords(a, {
        deleted: req.nextUrl.searchParams.get('trash') === '1',
        search: req.nextUrl.searchParams.get('q') ?? '',
      });
      const characters = (
        await conn.query(
          "SELECT id,title,owner_id FROM records WHERE campaign_id=$1 AND kind='character' AND deleted_at IS NULL AND ($2='master' OR id=ANY($3::uuid[])) ORDER BY title",
          [campaignId, a.role, await characterIds(a)],
        )
      ).rows;
      const folders =
        a.role === 'master'
          ? (
              await conn.query('SELECT * FROM folders WHERE campaign_id=$1 ORDER BY name', [
                campaignId,
              ])
            ).rows
          : [];
      const members =
        a.role === 'master'
          ? (
              await conn.query(
                'SELECT u.id,u.email,u.name,m.role,m.active FROM members m JOIN users u ON u.id=m.user_id WHERE campaign_id=$1',
                [campaignId],
              )
            ).rows
          : [];
      const invitations =
        a.role === 'master'
          ? (
              await conn.query(
                'SELECT id,email,role,expires,accepted_at FROM invitations WHERE campaign_id=$1',
                [campaignId],
              )
            ).rows
          : [];
      const audit =
        a.role === 'master'
          ? (
              await conn.query(
                'SELECT action,created_at FROM audit WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 10',
                [campaignId],
              )
            ).rows
          : [];
      const ownProposals =
        a.role === 'player' && !a.preview
          ? (
              await conn.query(
                "SELECT id,title,body,status,created_at FROM records WHERE campaign_id=$1 AND kind='proposal' AND owner_id=$2 AND deleted_at IS NULL",
                [campaignId, a.userId],
              )
            ).rows
          : [];
      const rolls = a.preview
        ? []
        : (
            await conn.query(
              "SELECT id,data,created_at FROM records WHERE campaign_id=$1 AND kind='roll' AND owner_id=$2 ORDER BY created_at DESC LIMIT 20",
              [campaignId, a.userId],
            )
          ).rows;
      return json({
        campaign,
        role: a.role,
        preview: !!a.preview,
        records,
        characters,
        characterSelection: await characterChoices(a),
        folders,
        members,
        invitations,
        audit,
        ownProposals,
        threadCount: (await community.threads(a)).length,
        rolls,
      });
    }
    if (section === 'characters') {
      if (method === 'GET' && id === 'choices') return json(await characterChoices(a));
      if (method === 'POST' && id && p[4] === 'claim')
        return json(await claimCharacter(a, uuid(id)));
    }
    if (section === 'integrations') {
      assert(!integration, 403, 'Las integraciones no administran credenciales');
      if (method === 'GET') return json(await listIntegrations(a));
      if (method === 'POST') return json(await createIntegration(a, await body(req)), 201);
      if (method === 'DELETE' && id) return json(await revokeIntegration(a, uuid(id)));
    }
    if (section === 'journals') {
      if (method === 'GET') return json(await community.journals(a));
      if (method === 'POST') return json(await community.createJournal(a, await body(req)), 201);
      if (method === 'PATCH' && id)
        return json(await community.editJournal(a, uuid(id), await body(req)));
    }
    if (section === 'threads') {
      if (method === 'GET')
        return json(id ? await community.threadDetail(a, uuid(id)) : await community.threads(a));
      if (method === 'POST' && !id)
        return json(await community.createThread(a, await body(req)), 201);
      if (method === 'POST' && id)
        return json(
          p[4] === 'send'
            ? await community.sendThread(a, uuid(id))
            : await community.replyThread(a, uuid(id), await body(req)),
        );
    }
    if (section === 'commerce') {
      if (method === 'GET') return json(await commerce.commerce(a));
      if (method === 'POST') {
        const input = await body(req);
        if (id === 'currencies') return json(await commerce.createCurrency(a, input), 201);
        if (id === 'wallets') return json(await commerce.adjustWallet(a, input));
        if (id === 'products') return json(await commerce.createProduct(a, input), 201);
        if (id === 'catalog' && p[4])
          return json(await commerce.revealProduct(a, uuid(p[4]), input));
        if (id === 'purchases')
          return json(
            p[4]
              ? await commerce.confirmPurchase(a, uuid(p[4]), input)
              : await commerce.requestPurchase(a, input),
            201,
          );
        if (id === 'inventory')
          return json(
            p[4]
              ? await commerce.transferItem(a, uuid(p[4]), input)
              : await commerce.deliverItem(a, input),
            201,
          );
      }
    }
    if (section === 'records') {
      if (!id && method === 'POST') {
        const input = await body(req);
        if (integration) {
          assert(
            [
              'session',
              'lore',
              'npc',
              'villain',
              'relic',
              'mechanic',
              'idea',
              'quest',
              'pending',
            ].includes(input.kind),
            403,
            'La integración solo prepara contenido de campaña',
          );
          input.status = 'borrador';
        }
        return json(await service.createRecord(a, input), 201);
      }
      if (!id && method === 'GET')
        return json(await visibleRecords(a, { search: req.nextUrl.searchParams.get('q') ?? '' }));
      uuid(id);
      if (p[4] === 'assign' && method === 'POST')
        return json(await service.assignCharacter(a, id, await body(req)));
      if (p[4] === 'restore' && method === 'POST')
        return json(await service.trashRecord(a, id, true));
      if (p[4] === 'revisions' && method === 'POST')
        return json(await service.restoreRevision(a, id, await body(req)));
      if (p[4] === 'fragments' && method === 'POST')
        return json(await service.addFragment(a, id, await body(req)), 201);
      if (p[4] === 'links' && method === 'POST') {
        master(a);
        await readRecord(a, id);
        const target = uuid((await body(req)).target_id);
        await readRecord(a, target);
        await conn.transaction(async (tx) => {
          await tx.query(
            'INSERT INTO record_links(campaign_id,source_id,target_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            [campaignId, id, target],
          );
          await service.audit(tx, a, 'vincular', id, { target });
        });
        return json({ ok: true });
      }
      if (method === 'GET') {
        const record = await readRecord(a, id);
        const attachments = (
          await conn.query(
            'SELECT * FROM attachments WHERE campaign_id=$1 AND (record_id=$2 OR fragment_id=$2)',
            [campaignId, id],
          )
        ).rows;
        const files = [];
        for (const f of attachments)
          if (await canReadAttachment(a, f))
            files.push({
              id: f.id,
              name: f.name,
              mime: f.mime,
              size: f.size,
              fragment_id: f.fragment_id,
            });
        let fragments: unknown[] = [],
          revisions: unknown[] = [],
          links: unknown[] = [];
        if (a.role === 'master') {
          fragments = (
            await conn.query(
              "SELECT f.*,COALESCE((SELECT json_agg(json_build_object('character_id',g.character_id,'source',g.source,'opened_at',g.opened_at)) FROM grants g WHERE g.fragment_id=f.id),'[]') AS grants FROM fragments f WHERE f.record_id=$1 AND f.campaign_id=$2 ORDER BY f.created_at",
              [id, campaignId],
            )
          ).rows;
          revisions = (
            await conn.query(
              'SELECT version,created_at,snapshot FROM revisions WHERE record_id=$1 AND campaign_id=$2 ORDER BY version DESC LIMIT 30',
              [id, campaignId],
            )
          ).rows;
          links = (
            await conn.query(
              'SELECT r.id,r.title FROM records r JOIN record_links l ON l.target_id=r.id WHERE l.source_id=$1 AND l.campaign_id=$2 AND r.deleted_at IS NULL',
              [id, campaignId],
            )
          ).rows;
        } else if (record.fragment && !a.preview) {
          await conn.query(
            'UPDATE grants SET opened_at=COALESCE(opened_at,now()) WHERE fragment_id=$1 AND character_id=ANY($2::uuid[])',
            [id, await characterIds(a)],
          );
        }
        return json({ record, attachments: files, fragments, revisions, links });
      }
      if (method === 'PATCH') {
        const input = await body(req);
        if (integration) {
          const current = await readRecord(a, id);
          assert(
            current.status === 'borrador' && current.kind !== 'character',
            403,
            'Solo se editan borradores con esta credencial',
          );
          input.status = 'borrador';
        }
        return json(await service.updateRecord(a, id, input));
      }
      if (method === 'DELETE') return json(await service.trashRecord(a, id));
    }
    if (section === 'fragments' && id && method === 'POST') {
      uuid(id);
      return json(await service.reveal(a, id, await body(req)));
    }
    if (section === 'folders') {
      if (method === 'POST') return json(await service.createFolder(a, await body(req)), 201);
      if (method === 'PATCH' && id)
        return json(await service.updateFolder(a, uuid(id), await body(req)));
    }
    if (section === 'invitations' && method === 'POST')
      return json(await service.invite(a, await body(req)), 201);
    if (section === 'members' && method === 'PATCH' && id) {
      const p = z.object({ active: z.boolean() }).parse(await body(req));
      return json(await service.setMember(a, uuid(id), p.active));
    }
    if (section === 'proposals' && method === 'POST')
      return json(await service.propose(a, await body(req)), 201);
    if (section === 'rolls' && method === 'POST')
      return json(await service.roll(a, await body(req)), 201);
    if (section === 'storage') {
      master(a);
      if (method === 'GET') return json(storageStatus());
      if (method === 'POST' && id === 'check') return json(await checkDrive(a));
      if (method === 'POST' && id === 'backup') {
        await rateLimit(`drive-backup:${a.userId}`, 2, 300);
        const result = await backupToDrive(a);
        return json({ saved: true, bytes: result.bytes, scope: result.scope }, 201);
      }
    }
    if (section === 'export' && method === 'GET') {
      master(a);
      await rateLimit(`export:${a.userId}`, 2, 300);
      return new NextResponse(JSON.stringify(await exportCampaign(a)), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="aetherfall-respaldo.json"',
          'Cache-Control': 'private, no-store',
        },
      });
    }
    if (section === 'attachments') {
      if (method === 'POST') {
        master(a);
        await rateLimit(`upload:${a.userId}`, 20, 300);
        const form = await req.formData();
        const recordId = uuid(String(form.get('record_id')));
        await readRecord(a, recordId);
        const fragmentId = form.get('fragment_id') ? uuid(String(form.get('fragment_id'))) : null;
        if (integration)
          assert(!fragmentId, 403, 'Los archivos de integración se guardan en privado');
        if (fragmentId)
          assert(
            await one('SELECT id FROM fragments WHERE id=$1 AND campaign_id=$2 AND record_id=$3', [
              fragmentId,
              campaignId,
              recordId,
            ]),
          );
        const f = form.get('file');
        assert(f instanceof File, 400, 'Elegí un archivo');
        const data = Buffer.from(await f.arrayBuffer());
        validateFile(data, f.type);
        const hash = createHash('sha256').update(data).digest('hex');
        const exists = await one(
          'SELECT id FROM attachments WHERE record_id=$1 AND sha256=$2 AND fragment_id IS NOT DISTINCT FROM $3::uuid',
          [recordId, hash, fragmentId],
        );
        if (exists) return json({ id: exists.id, duplicate: true });
        const fileId = randomUUID(),
          key = randomUUID();
        const name = f.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 180) || 'archivo';
        const objectKey = await putObject(key, data, f.type, name);
        await conn.transaction(async (tx) => {
          await tx.query(
            'INSERT INTO attachments(id,campaign_id,record_id,fragment_id,name,mime,size,object_key,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [fileId, campaignId, recordId, fragmentId, name, f.type, data.length, objectKey, hash],
          );
          await service.audit(tx, a, 'adjuntar', fileId);
        });
        return json({ id: fileId }, 201);
      }
      if (method === 'GET' && id) {
        uuid(id);
        const f = await one('SELECT * FROM attachments WHERE id=$1 AND campaign_id=$2', [
          id,
          campaignId,
        ]);
        assert(f && (await canReadAttachment(a, f)));
        await conn.transaction((tx) => service.audit(tx, a, 'abrir-archivo', id));
        if (proxyObject(f.object_key)) {
          const b = await readObject(f.object_key);
          assert(
            b.length === f.size && createHash('sha256').update(b).digest('hex') === f.sha256,
            409,
            'El archivo fue modificado fuera de Aetherfall; revisá su integridad antes de compartirlo.',
          );
          return new NextResponse(new Uint8Array(b), {
            headers: {
              'Content-Type': f.mime,
              'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
              'Cache-Control': 'private, no-store',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        }
        return NextResponse.redirect(await signedObject(f.object_key, f.mime, f.name), {
          status: 307,
          headers: { 'Cache-Control': 'private, no-store' },
        });
      }
    }
    throw new HttpError(404, 'Ruta no disponible');
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return json(
        {
          error: 'Revisá los datos ingresados',
          fields: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        400,
      );
    if (error instanceof SyntaxError)
      return json({ error: 'La solicitud no contiene JSON válido' }, 400);
    console.error('Operación fallida:', error instanceof Error ? error.name : 'Error');
    return json(
      { error: 'No se pudo completar la operación. Comprobá la configuración del servidor.' },
      500,
    );
  }
}
async function body(req: NextRequest) {
  assert(
    req.headers.get('content-type')?.includes('application/json'),
    415,
    'Usá application/json',
  );
  const text = await req.text();
  assert(Buffer.byteLength(text) <= 256 * 1024, 413, 'Texto demasiado grande');
  return JSON.parse(text);
}
function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
  });
}
export { dispatch as GET, dispatch as POST, dispatch as PATCH, dispatch as DELETE };
