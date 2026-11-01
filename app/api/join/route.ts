import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import { registerFromLink } from '@/lib/join-links';
import { rateLimit } from '@/lib/auth';
import { assert, HttpError } from '@/lib/errors';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    assert(
      req.headers.get('origin') === new URL(process.env.NEXTAUTH_URL || req.url).origin,
      403,
      'Origen no autorizado',
    );
    assert(req.headers.get('content-type')?.includes('application/json'), 415, 'Usá JSON');
    const raw = await req.text();
    assert(Buffer.byteLength(raw) <= 2048, 413, 'Solicitud demasiado grande');
    const input = JSON.parse(raw);
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    await rateLimit(`join-ip:${createHash('sha256').update(ip).digest('hex')}`, 20, 900);
    if (typeof input.email === 'string')
      await rateLimit(`join-email:${input.email.toLowerCase()}`, 5, 900);
    await registerFromLink(input);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const status =
      e instanceof HttpError
        ? e.status
        : e instanceof ZodError || e instanceof SyntaxError
          ? 400
          : 500;
    return NextResponse.json(
      { error: e instanceof HttpError ? e.message : 'No se pudo procesar la invitación.' },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
