'use client';

import { useState } from 'react';

export default function VideoTestPage() {
  const [roomId, setRoomId] = useState('');
  const [recordingId, setRecordingId] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [recordingData, setRecordingData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [videoSrc, setVideoSrc] = useState('');

  const checkRoom = async () => {
    if (!roomId) return;
    
    setLoading(true);
    setError(null);
    setRoomData(null);
    
    try {
      const res = await fetch(`/api/recordings/rooms/${roomId}/check`);
      const data = await res.json();
      
      if (res.ok) {
        setRoomData(data);
      } else {
        setError(data.error || 'Failed to check room recordings');
      }
    } catch (err) {
      setError('An error occurred while checking room recordings');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const checkRecording = async () => {
    if (!recordingId) return;
    
    setLoading(true);
    setError(null);
    setRecordingData(null);
    setVideoSrc('');
    
    try {
      const res = await fetch(`/api/recordings/check/${recordingId}`);
      const data = await res.json();
      
      if (res.ok && data.exists) {
        setRecordingData(data);
        setVideoSrc(`/api/recordings/stream/${recordingId}`);
      } else {
        setError(data.error || 'Recording not found');
      }
    } catch (err) {
      setError('An error occurred while checking recording');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadVideo = (id) => {
    setRecordingId(id);
    setVideoSrc(`/api/recordings/stream/${id}`);
    setRecordingData(null);
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Video Recording Test Tool</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Check Room Recordings</h2>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="Enter Room ID"
              className="flex-1 p-2 border rounded"
            />
            <button
              onClick={checkRoom}
              disabled={loading || !roomId}
              className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-300"
            >
              Check
            </button>
          </div>
          
          {roomData && (
            <div className="mt-4">
              <h3 className="font-medium">Room: {roomData.roomId}</h3>
              <p>Recordings: {roomData.recordingsCount}</p>
              
              {roomData.recordings.length > 0 ? (
                <div className="mt-2">
                  <h4 className="font-medium">Available Recordings:</h4>
                  <ul className="mt-2 space-y-2">
                    {roomData.recordings.map((recording) => (
                      <li key={recording.id} className="border p-2 rounded">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm font-medium">ID: {recording.id}</p>
                            <p className="text-sm">Role: {recording.role}</p>
                            <p className="text-sm">Size: {Math.round(recording.size / 1024 / 1024 * 100) / 100} MB</p>
                          </div>
                          <button
                            onClick={() => loadVideo(recording.id)}
                            className="bg-green-500 text-white px-3 py-1 rounded text-sm"
                          >
                            Load
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-2 text-red-500">No recordings found for this room</p>
              )}
            </div>
          )}
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Check Specific Recording</h2>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={recordingId}
              onChange={(e) => setRecordingId(e.target.value)}
              placeholder="Enter Recording ID"
              className="flex-1 p-2 border rounded"
            />
            <button
              onClick={checkRecording}
              disabled={loading || !recordingId}
              className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-300"
            >
              Check
            </button>
          </div>
          
          {recordingData && (
            <div className="mt-4">
              <h3 className="font-medium">Recording Details:</h3>
              <pre className="bg-gray-100 p-2 rounded mt-2 text-xs overflow-auto max-h-40">
                {JSON.stringify(recordingData, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
      
      {videoSrc && (
        <div className="mt-6 bg-white p-4 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Video Preview</h2>
          <div className="aspect-video bg-black rounded overflow-hidden">
            <video
              src={videoSrc}
              controls
              className="w-full h-full"
              onError={() => setError('Failed to load video. The file may be corrupted or not accessible.')}
            />
          </div>
          <div className="mt-4 flex justify-between">
            <p className="text-sm">Recording ID: {recordingId}</p>
            <button
              onClick={() => window.open(videoSrc, '_blank')}
              className="bg-blue-500 text-white px-3 py-1 rounded text-sm"
            >
              Open in New Tab
            </button>
          </div>
        </div>
      )}
      
      {error && (
        <div className="mt-6 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          <p className="font-bold">Error:</p>
          <p>{error}</p>
        </div>
      )}
      
      {loading && (
        <div className="mt-6 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
          <p className="mt-2">Loading...</p>
        </div>
      )}
    </div>
  );
} 