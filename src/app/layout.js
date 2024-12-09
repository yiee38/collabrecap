import '@/app/globals.css';

export const metadata = {
  title: 'CollabRecap',
  description: 'Real-time collaboration platform'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}