import '@/app/globals.css';
import { UserProvider } from '@auth0/nextjs-auth0/client';

export const metadata = {
  title: 'CollabRecap',
  description: 'Real-time collaboration platform'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <UserProvider>
        <body>{children}</body>
      </UserProvider>
    </html>
  );
}