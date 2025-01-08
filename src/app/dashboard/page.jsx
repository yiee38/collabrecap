'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { socketService } from '@/lib/socketService';
import { useSession } from 'next-auth/react';

const Dashboard = () => {
  const [myRooms, setMyRooms] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const router = useRouter();
  const { data: session, status } = useSession();

  // Redirect to home if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push('/');
    }
  }, [status, router]);

  useEffect(() => {
    if (!socketService.socket?.connected) {
      socketService.connect(process.env.NEXT_PUBLIC_SOCKET_URL);
    }
    
    socketService.socket.on('connect', () => {
      setIsConnected(true);
    });

    socketService.socket.on('disconnect', () => {
      setIsConnected(false);
    });

    return () => {
      socketService.disconnect();
    };
  }, []);

  const createRoom = () => {
    if (!socketService.socket?.connected || !session?.user?.email) {
      console.error('Socket not connected or user not authenticated');
      return;
    }

    setIsCreatingRoom(true);
    
    socketService.socket.emit('room:create', { userId: session.user.email });
    
    socketService.socket.once('room:created', ({ roomId, room }) => {
      setMyRooms(prev => [...prev, room]);
      setIsCreatingRoom(false);
    });
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  if (status === "loading" || status === "unauthenticated") {
    return null;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Interview Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className={`inline-block w-3 h-3 rounded-full ${
            isConnected ? 'bg-green-500' : 'bg-red-500'
          }`} />
          <span className="text-sm text-gray-600">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      <button
        onClick={createRoom}
        disabled={isCreatingRoom || !isConnected}
        className="mb-8 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 
                 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
      >
        {isCreatingRoom ? 'Creating Room...' : 'Create New Room'}
      </button>
      
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {myRooms.map(room => (
          <div 
            key={room.id}
            className="p-6 bg-white rounded-lg shadow-md border border-gray-200"
          >
            <h3 className="text-xl font-semibold mb-4">Room {room.id}</h3>
            <div className="flex items-center gap-2 mb-4">
              <span className={`px-2 py-1 text-sm rounded-full ${
                room.state === 'CREATED' 
                  ? 'bg-blue-100 text-blue-800'
                  : room.state === 'ACTIVE'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {room.state}
              </span>
            </div>

            {room.state === 'CREATED' && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600 mb-2">Interviewer Link:</p>
                  <div className="flex gap-2 items-center">
                    <input
                      readOnly
                      value={`${window.location.origin}/room/${room.id}/interviewer`}
                      className="flex-1 px-3 py-2 border rounded-md text-sm"
                    />
                    <button
                      onClick={() => copyToClipboard(
                        `${window.location.origin}/room/${room.id}/interviewer`
                      )}
                      className="p-2 text-blue-600 hover:text-blue-800"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-gray-600 mb-2">Candidate Link:</p>
                  <div className="flex gap-2 items-center">
                    <input
                      readOnly
                      value={`${window.location.origin}/room/${room.id}/interviewee`}
                      className="flex-1 px-3 py-2 border rounded-md text-sm"
                    />
                    <button
                      onClick={() => copyToClipboard(
                        `${window.location.origin}/room/${room.id}/interviewee`
                      )}
                      className="p-2 text-blue-600 hover:text-blue-800"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => router.push(`/room/${room.id}/interviewer`)}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-md 
                           hover:bg-blue-700 transition-colors"
                >
                  Enter Room
                </button>
              </div>
            )}

            {room.state === 'ACTIVE' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">Interview in progress...</p>
                <button
                  onClick={() => router.push(`/room/${room.id}/interviewer`)}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-md 
                           hover:bg-green-700 transition-colors"
                >
                  Rejoin Room
                </button>
              </div>
            )}

            {room.state === 'ARCHIVED' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">Interview completed</p>
                <button
                  onClick={() => router.push(`/room/${room.id}/interviewer`)}
                  className="w-full px-4 py-2 bg-gray-600 text-white rounded-md 
                           hover:bg-gray-700 transition-colors"
                >
                  View Recording
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {myRooms.length === 0 && (
        <div className="text-center text-gray-500 mt-8">
          No rooms created yet. Click the button above to create your first room.
        </div>
      )}
    </div>
  );
};

export default Dashboard;
