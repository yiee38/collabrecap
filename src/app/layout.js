import './globals.css';
import AuthProvider from '@/components/providers/AuthProvider';

export const metadata = {
  title: 'CollabRecap',
  description: 'Real-time collaboration platform',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
