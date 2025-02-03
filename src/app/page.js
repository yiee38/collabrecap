'use client';

import { useRouter } from 'next/navigation';
import { signIn, signOut, useSession } from 'next-auth/react';

export default function Home() {
  const router = useRouter();
  const { data: session } = useSession();
  
  const handleDashboardClick = async () => {
    if (session) {
      router.push('/dashboard');
    } else {
      await signIn('auth0', { 
        callbackUrl: '/dashboard',
        redirect: true,
      });
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-6">Welcome to CollabRecap</h1>
        <p className="text-gray-600 mb-8">Real-time collaboration platform for technical interviews</p>
        <div className="space-x-4">
          <button 
            onClick={handleDashboardClick}
            className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            {session ? 'Go to Dashboard' : 'Sign In'}
          </button>
          {session && (
            <button 
              onClick={() => signOut()}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
            >
              Sign Out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
