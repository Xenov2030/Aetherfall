import { getServerSession, type NextAuthOptions } from 'next-auth';
import { z } from 'zod';
import { createTransport } from 'nodemailer';
import EmailProvider from 'next-auth/providers/email';
import type { Adapter, AdapterUser } from 'next-auth/adapters';
import { randomUUID } from 'node:crypto';
import { db, one } from './db';
import { assert } from './errors';
const toUser = (r: any): AdapterUser => ({
  id: r.id,
  email: r.email,
  name: r.name,
  emailVerified: r.email_verified ? new Date(r.email_verified) : null,
  image: r.image,
});
const adapter: Adapter = {
  async createUser(user: Omit<AdapterUser, 'id'>) {
    const id = randomUUID();
    const row = await one(
      'INSERT INTO users(id,email,name,email_verified,image) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [
        id,
        user.email.toLowerCase(),
        user.name ?? null,
        user.emailVerified ?? null,
        user.image ?? null,
      ],
    );
    return toUser(row);
  },
  async getUser(id) {
    const r = await one('SELECT * FROM users WHERE id=$1', [id]);
    return r ? toUser(r) : null;
  },
  async getUserByEmail(email) {
    const r = await one('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    return r ? toUser(r) : null;
  },
  async updateUser(user) {
    const r = await one(
      'UPDATE users SET email_verified=COALESCE($2,email_verified),name=COALESCE($3,name) WHERE id=$1 RETURNING *',
      [user.id, user.emailVerified ?? null, user.name ?? null],
    );
    return toUser(r);
  },
  async createVerificationToken(t) {
    await (
      await db()
    ).query('INSERT INTO verification_tokens(identifier,token,expires) VALUES($1,$2,$3)', [
      t.identifier.toLowerCase(),
      t.token,
      t.expires,
    ]);
    return t;
  },
  async useVerificationToken(t) {
    const r = await one(
      'DELETE FROM verification_tokens WHERE identifier=$1 AND token=$2 RETURNING *',
      [t.identifier.toLowerCase(), t.token],
    );
    return r ? { identifier: r.identifier, token: r.token, expires: new Date(r.expires) } : null;
  },
};
export async function loginAllowed(email: string) {
  return !!(await one(
    `SELECT 1 FROM members m JOIN users u ON u.id=m.user_id WHERE lower(u.email)=$1 AND m.active=true UNION ALL SELECT 1 FROM invitations WHERE email=$1 AND accepted_at IS NULL AND expires>now() LIMIT 1`,
    [email.toLowerCase()],
  ));
}
export async function acceptInvitations(userId: string, email: string) {
  await (
    await db()
  ).transaction(async (tx) => {
    const invites = (
      await tx.query(
        'SELECT * FROM invitations WHERE email=$1 AND accepted_at IS NULL AND expires>now() FOR UPDATE',
        [email.toLowerCase()],
      )
    ).rows;
    for (const i of invites) {
      // Never reactivate a suspended membership through a stale invite.
      await tx.query(
        'INSERT INTO members(campaign_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(campaign_id,user_id) DO NOTHING',
        [i.campaign_id, userId, i.role],
      );
      await tx.query('UPDATE invitations SET accepted_at=now() WHERE id=$1', [i.id]);
    }
  });
}
export async function rateLimit(key: string, limit = 20, seconds = 60) {
  const r = await one(
    `INSERT INTO rate_limits(key,hits,resets_at) VALUES($1,1,now()+$2::int*interval '1 second') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.resets_at<now() THEN 1 ELSE rate_limits.hits+1 END,resets_at=CASE WHEN rate_limits.resets_at<now() THEN excluded.resets_at ELSE rate_limits.resets_at END RETURNING hits`,
    [key, seconds],
  );
  assert(r && r.hits <= limit, 429, 'Demasiadas solicitudes. Intentá de nuevo más tarde.');
}
export const authOptions: NextAuthOptions = {
  adapter,
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/login', verifyRequest: '/login?enviado=1', error: '/login' },
  providers: [
    EmailProvider({
      server: process.env.SMTP_URL || 'smtp://127.0.0.1:2525',
      from: process.env.EMAIL_FROM || 'Aetherfall <acceso@localhost>',
      maxAge: 15 * 60,
      normalizeIdentifier: (identifier) =>
        z.email().max(254).parse(identifier.trim().toLowerCase()),
      async sendVerificationRequest({ identifier, url, provider }) {
        const transport = createTransport(provider.server);
        const result = await transport.sendMail({
          to: identifier,
          from: provider.from,
          subject: 'Tu acceso a Aetherfall',
          text: `Abrí este enlace para entrar a Aetherfall:\n\n${url}\n\nEs válido durante 15 minutos y solo se puede usar una vez. Si no solicitaste este acceso, ignorá el mensaje.`,
        });
        if (result.rejected?.length || result.pending?.length)
          throw new Error('El servicio de correo no aceptó el mensaje');
      },
    }),
  ],
  events: {
    async signIn({ user }) {
      if (user.email) await acceptInvitations(user.id, user.email);
    },
  },
  callbacks: {
    async signIn({ user, email }) {
      if (!user.email) return false;
      if (email?.verificationRequest) {
        await rateLimit(`login:${user.email.toLowerCase()}`, 5, 900);
        return loginAllowed(user.email);
      }
      if (!(await loginAllowed(user.email))) return false;
      return true;
    },
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) Object.assign(session.user, { id: token.sub });
      return session;
    },
  },
  logger: {
    error(code) {
      console.error('Autenticación:', code);
    },
    warn(code) {
      console.warn('Autenticación:', code);
    },
    debug() {},
  },
};
export async function currentUser() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  return id ? { id, email: session?.user?.email } : null;
}
