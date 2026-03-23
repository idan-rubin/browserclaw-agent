import NextAuth, { type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { requireEnv } from '@/lib/env';

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: '/auth/login' },

  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (credentials?.email == null || credentials.email === '' || !credentials.password) return null;

        const authServiceUrl = requireEnv('AUTH_SERVICE_URL');
        const res = await fetch(`${authServiceUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
        });

        if (!res.ok) return null;

        const data = (await res.json()) as { id: string; name: string; email: string };
        return {
          id: data.id,
          name: data.name,
          email: data.email,
        };
      },
    }),
  ],

  callbacks: {
    jwt({ token, user }) {
      token.id = user.id;
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      return session;
    },
  },
};

const handler = NextAuth(authOptions) as unknown as (...args: unknown[]) => Promise<Response>;
export { handler as GET, handler as POST };
