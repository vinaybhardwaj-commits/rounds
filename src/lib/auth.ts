import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { neon } from '@neondatabase/serverless';

// Lazy-init: avoid calling neon() at module load time (breaks Next.js build)
let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (!_sql) _sql = neon(process.env.POSTGRES_URL!);
  return _sql;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // Restrict to @even.in domain for internal staff
          hd: 'even.in',
        },
      },
    }),
  ],
  pages: {
    signIn: '/auth/signin',
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;

      const isInternal = user.email.endsWith('@even.in');

      // Auto-provision internal staff on first login
      if (isInternal) {
        const existing = await getSql()`
          SELECT id FROM profiles WHERE email = ${user.email}
        `;

        if (existing.length === 0) {
          // Create profile on first OAuth login
          await getSql()`
            INSERT INTO profiles (email, full_name, display_name, avatar_url, role, account_type)
            VALUES (
              ${user.email},
              ${user.name || user.email.split('@')[0]},
              ${user.name || null},
              ${user.image || null},
              ${'staff'},
              ${'internal'}
            )
          `;
        } else {
          // Update avatar and last_seen on subsequent logins
          await getSql()`
            UPDATE profiles
            SET avatar_url = ${user.image || null},
                last_seen_at = NOW()
            WHERE email = ${user.email}
          `;
        }
        return true;
      }

      // Guest users must have a valid invitation
      const invitation = await getSql()`
        SELECT id FROM guest_invitations
        WHERE email = ${user.email}
          AND accepted_at IS NULL
          AND expires_at > NOW()
      `;

      return invitation.length > 0;
    },

    async session({ session }) {
      if (session.user?.email) {
        // Attach profile data to session
        const profile = await getSql()`
          SELECT p.id, p.role, p.account_type, p.department_id, p.is_active,
                 d.name as department_name, d.slug as department_slug
          FROM profiles p
          LEFT JOIN departments d ON p.department_id = d.id
          WHERE p.email = ${session.user.email}
        `;

        if (profile[0]) {
          const p = profile[0] as Record<string, unknown>;
          const u = session.user as unknown as Record<string, unknown>;
          u.profileId = p.id;
          u.role = p.role;
          u.accountType = p.account_type;
          u.departmentId = p.department_id;
          u.departmentName = p.department_name;
          u.isActive = p.is_active;
        }
      }
      return session;
    },
  },
});
