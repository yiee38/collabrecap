import { withAuth } from "next-auth/middleware"

// Use withAuth for all routes, but configure it to handle room routes specially
export default withAuth(
  function middleware(req) {
    return null; // Let NextAuth handle the response
  },
  {
    callbacks: {
      authorized: ({ req, token }) => {
        // Allow room routes to pass through - they handle auth internally
        if (req.nextUrl.pathname.startsWith('/room/')) {
          return true;
        }
        // For all other routes, require authentication
        return !!token;
      },
    },
    pages: {
      signIn: "/",
    },
  }
);

export const config = {
  matcher: [
    // Match all paths except public ones
    '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
}
