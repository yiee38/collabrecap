'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { socketService } from '@/lib/socketService';
import { useSession } from 'next-auth/react';

const Dashboard = () => {
  const [interviewerRooms, setInterviewerRooms] = useState([]);
  const [intervieweeRooms, setIntervieweeRooms] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const router = useRouter();
  const { data: session, status } = useSession();

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

  const fetchRooms = async () => {
    try {
      const res = await fetch(`/api/activeRooms/${session.user.email}`);
      if (res.ok) {
        const data = await res.json();
        setInterviewerRooms(data.interviewer || []);
        setIntervieweeRooms(data.interviewee || []);
      }
    } catch (err) {
      console.error('Could not load rooms:', err);
    }
  };

  useEffect(() => {
    if (session?.user) {
      fetchRooms();
    }
  }, [session]);

  const createRoom = () => {
    if (!socketService.socket?.connected || !session?.user?.email) {
      console.error('Socket not connected or user not authenticated');
      return;
    }

    setIsCreatingRoom(true);
    
    socketService.socket.emit('room:create', { userId: session.user.email });
    
    socketService.socket.once('room:created', ({ roomId, room }) => {
      setInterviewerRooms(prev => [room, ...prev]);
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

  const sendInvite = (roomId, role) => {
    const email = prompt('Enter interviewee email:');
    if (email) {
      const subject = 'Interview Room Invitation';
      const body = `You have been invited to join an interview room.\n\nPlease click the following link to join:\n${window.location.origin}/room/${roomId}/${role}`;
      window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }
  };

  if (status === "loading" || status === "unauthenticated") {
    return null;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Interview Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className={`inline-block w-2 h-2 rounded-full ${
            isConnected ? 'bg-green-500' : 'bg-red-500'
          }`} />
          <span className="text-xs text-gray-600">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
          <span>as {session.user.email}</span>
        </div>
      </div>

      <button
        onClick={createRoom}
        disabled={isCreatingRoom || !isConnected}
        className="mb-6 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 
                 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
      >
        {isCreatingRoom ? 'Creating Room...' : 'Create New Room'}
      </button>
      
      <div className="flex gap-8 h-[550px]">
        {/* Interviewer Rooms */}
        <div className="flex-1 ">
          <h2 className="text-lg font-semibold mb-3">Interviewer Rooms</h2>
          <div className="h-full border overflow-y-auto pr-2 bg-gray-50/50 rounded p-2">
            <div className="space-y-2">
              {interviewerRooms.map(room => (
                <div key={room.id} className="p-3 bg-white rounded border border-gray-200">
                  <h3 className="text-sm font-medium mb-2">Room {room.id}</h3>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      room.state === 'CREATED' ? 'bg-blue-100 text-blue-800' :
                      room.state === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {room.state}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Room Link:</p>
                      <div className="flex gap-2 items-center">
                        <input
                          readOnly
                          value={`${window.location.origin}/room/${room.id}/interviewee`}
                          className="flex-1 px-2 py-1 border rounded text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => copyToClipboard(`${window.location.origin}/room/${room.id}/interviewee`)}
                            className="p-1.5 text-blue-600 hover:text-blue-800 text-sm"
                          >
                            Copy
                          </button>
                          <button
                            onClick={() => sendInvite(room.id, 'interviewee')}
                            className="p-1.5 text-blue-600 hover:text-blue-800 text-sm"
                          >
                            Send To
                          </button>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => router.push(`/room/${room.id}/interviewer`)}
                      className={`w-full px-3 py-1.5 text-white text-xs rounded transition-colors ${
                        room.state === 'CREATED' ? 'bg-blue-600 hover:bg-blue-700' :
                        room.state === 'ACTIVE' ? 'bg-green-600 hover:bg-green-700' :
                        'bg-gray-600 hover:bg-gray-700'
                      }`}
                    >
                      {room.state === 'CREATED' ? 'Enter Room' :
                       room.state === 'ACTIVE' ? 'Rejoin Room' :
                       'View Recording'}
                    </button>
                  </div>
                </div>
              ))}
              <div className={`text-center text-gray-500 p-3 bg-white rounded border border-gray-200 text-xs ${interviewerRooms.length > 0 ? 'hidden' : ''}`}>
                No interviewer rooms yet.
              </div>
            </div>
          </div>
        </div>

        {/* Interviewee Rooms */}
        <div className="flex-1 ">
          <h2 className="text-lg font-semibold mb-3">Interviewee Rooms</h2>
          <div className="h-full border overflow-y-auto pr-2 bg-gray-50/50 rounded p-2">
            <div className="space-y-2">
              {intervieweeRooms.map(room => (
                <div key={room.id} className="p-3 bg-white rounded border border-gray-200">
                  <h3 className="text-sm font-medium mb-2">Room {room.id}</h3>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      room.state === 'CREATED' ? 'bg-blue-100 text-blue-800' :
                      room.state === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {room.state}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs text-gray-600 mb-1">Room Link:</p>
                      <div className="flex gap-2 items-center">
                        <input
                          readOnly
                          value={`${window.location.origin}/room/${room.id}/interviewee`}
                          className="flex-1 px-2 py-1 border rounded text-xs"
                        />
                        <button
                          onClick={() => copyToClipboard(`${window.location.origin}/room/${room.id}/interviewee`)}
                          className="p-1.5 text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Copy
                        </button>
                        <button
                          onClick={() => sendInvite(room.id, 'interviewee')}
                          className="p-1.5 text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Send To
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => router.push(`/room/${room.id}/interviewee`)}
                      className={`w-full px-3 py-1.5 text-white text-xs rounded transition-colors ${
                        room.state === 'CREATED' ? 'bg-blue-600 hover:bg-blue-700' :
                        room.state === 'ACTIVE' ? 'bg-green-600 hover:bg-green-700' :
                        'bg-gray-600 hover:bg-gray-700'
                      }`}
                    >
                      {room.state === 'CREATED' ? 'Enter Room' :
                       room.state === 'ACTIVE' ? 'Rejoin Room' :
                       'View Recording'}
                    </button>
                  </div>
                </div>
              ))}
              <div className={`text-center text-gray-500 p-3 bg-white rounded border border-gray-200 text-xs ${intervieweeRooms.length > 0 ? 'hidden' : ''}`}>
                No interviewee rooms yet.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
