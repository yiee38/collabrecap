import GithubProvider from "next-auth/providers/github"
import Auth0Provider from "next-auth/providers/auth0"

export const authOptions = {
  providers: [
    Auth0Provider({
      clientId: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
      issuer: process.env.AUTH0_ISSUER_BASE_URL,
      authorization: {
        params: {
          prompt: "login",
        },
      },
    })
  ],
  pages: {
    signIn: "/",
  },
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  callbacks: {
    async session({ session, token }) {
      if (token) {
        session.user.id = session.user.email
      }
      return session
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.email
      }
      return token
    },
    async redirect({ url, baseUrl }) {
      // If the url contains a callbackUrl parameter, use that
      const callbackUrl = new URL(url, baseUrl).searchParams.get('callbackUrl');
      if (callbackUrl) {
        // Make sure the callback URL is on our domain
        const returnTo = new URL(callbackUrl, baseUrl);
        if (returnTo.origin === baseUrl) {
          return returnTo.toString();
        }
      }
      
      // If it's a relative url, make it absolute
      if (url.startsWith('/')) {
        return `${baseUrl}${url}`
      }
      
      // If it's already an absolute url on our domain, allow it
      if (url.startsWith(baseUrl)) {
        return url
      }
      
      // Default to homepage
      return baseUrl
    }
  }
}
