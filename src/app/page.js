'use client';

import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  
  return (
    <div>
      <h1>Welcome to CollabRecap</h1>
      <button onClick={() => router.push('/dashboard')}>
        Go to Dashboard
      </button>
    </div>
  );
}