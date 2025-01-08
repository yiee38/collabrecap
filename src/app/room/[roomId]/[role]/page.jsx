'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { socketService } from '@/lib/socketService';
import CodeEditor from '@/components/CodeEditor';
import Timeline from '@/components/Timeline';
import NotePad from '@/components/Notepad';
import CollaborationService from '@/lib/collaborationService';
import { Button } from '@/components/ui/button';
import { useSession, signIn } from "next-auth/react";
import { getArchivedRoom } from '@/lib/apiAgent';

const INTERVAL_MS = 50;

const InterviewRoom = () => {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId;
  const role = params.role;
  const { data: session, status } = useSession();
  const [remotePointers, setRemotePointers] = useState({});


  // Room state
  const [roomState, setRoomState] = useState('CREATED');
  const [error, setError] = useState(null);
  const [participants, setParticipants] = useState({
    interviewer: false,
    interviewee: false
  });
  
  // Timeline and playback state
  const [operations, setOperations] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineController, setTimelineController] = useState(null);
  
  // Refs for timing management
  const startTimeRef = useRef(null);
  const endTimeRef = useRef(null);
  const playIntervalRef = useRef(null);
  const collaborationRef = useRef(null);
  const lastUpdateRef = useRef(null);
  const notepadRef = useRef(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      const callbackUrl = `/room/${roomId}/${role}`;
      signIn('auth0', { callbackUrl });
      return;
    }

    if (status === "authenticated" && session?.user?.email) {
      const setupRoom = async () => {
        try {
          // Try to fetch archived room first
          try {
            const room = await getArchivedRoom(roomId);
            console.log('Found archived room:', room);
            
            // Initialize room state from archived data
            setRoomState('ARCHIVED');
            setDuration(room.duration);
            startTimeRef.current = room.startedAt;
            endTimeRef.current = room.endTime;
            setOperations(room.codeOperations || []);
            
            // Initialize collaboration service for replay
            collaborationRef.current = new CollaborationService(roomId, session.user.email, role);
            collaborationRef.current.onTimelineUpdate(({ currentTime, controlledBy }) => {
              if (controlledBy !== session.user.email) {
                setCurrentTime(currentTime);
              }
              setTimelineController(controlledBy);
            });
            return;
          } catch (err) {
            // Not found in archive (404) means it might be an active room
            // Only log error if it's not a 404
            if (err?.response?.status !== 404) {
              console.error('Error fetching room:', err);
            }
          }

          // Connect to socket for active room
          await socketService.connect(process.env.NEXT_PUBLIC_SOCKET_URL);

          socketService.onError((error) => {
            console.log('Socket error:', error);
            setError('Room not found');
          });

          socketService.joinRoom(roomId, session.user.email, role);
          
          // Handle room status updates
          socketService.onRoomStatus((room) => {
            setRoomState(room.state);
            if (room.state === 'ACTIVE' && !startTimeRef.current) {
              startTimeRef.current = Date.now();
            } else if (room.state === 'ARCHIVED' && room.endTime) {
              endTimeRef.current = room.endTime;
              setDuration(room.duration || (room.endTime - startTimeRef.current));
            }

            // Update participants status
            setParticipants({
              interviewer: !!room.roles.interviewer,
              interviewee: !!room.roles.interviewee
            });
          });

          // Handle explicit room end event
          socketService.socket.on('room:ended', ({ endTime, duration }) => {
            endTimeRef.current = endTime;
            setDuration(duration);
            setRoomState('ARCHIVED');
          });

          // Initialize collaboration service
          collaborationRef.current = new CollaborationService(roomId, session.user.email, role);

          collaborationRef.current.onTimelineUpdate(({ currentTime, controlledBy }) => {
            if (controlledBy !== session.user.email) {
              setCurrentTime(currentTime);
            }
            setTimelineController(controlledBy);
          });

          collaborationRef.current.onPointerUpdate((pointer) => {
            let rp = {};
            
            Object.keys(pointer).forEach((key) => {
              if (key !== session.user.email) {
                rp = pointer[key];
              }
            });
            setRemotePointers(rp)
          });

        } catch (err) {
          setError(err.message);
        }
      };

      setupRoom();

      return () => {
        if (playIntervalRef.current) {
          clearInterval(playIntervalRef.current);
        }
        collaborationRef.current?.destroy();
        socketService.disconnect();
      };
    }
  }, [status, roomId, session?.user?.email, role]);

  const startInterview = () => {
    if (role === 'interviewer') {
      socketService.socket.emit('room:start', { roomId, userId: session.user.email });
      startTimeRef.current = Date.now();
    }
  };

  const endInterview = async () => {    
    if (role === 'interviewer') {
      const newDuration = Date.now() - startTimeRef.current;
      await collaborationRef.current?.requestTimelineControl();
      collaborationRef.current?.updateTimeline(newDuration);
      console.log(operations);

      socketService.socket.emit('room:end', { 
        roomId, 
        userId: session.user.email,
        operations,
        duration: newDuration 
      });
      collaborationRef.current?.releaseTimelineControl();
    }
  };

  const handleOperationsUpdate = (newOperations, newDuration) => {
    setOperations(newOperations);
    setDuration(newDuration);
  };

  const togglePlayback = async () => {
    await collaborationRef.current?.requestTimelineControl();

    if (isPlaying) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
      setIsPlaying(false);
      collaborationRef.current?.releaseTimelineControl();
    } else {
      const startPosition = currentTime >= duration ? 0 : currentTime;
      setCurrentTime(startPosition);
      setIsPlaying(true);
      lastUpdateRef.current = Date.now();

      playIntervalRef.current = setInterval(() => {
        const now = Date.now();
        const deltaTime = now - lastUpdateRef.current;
        lastUpdateRef.current = now;

        setCurrentTime(prev => {
          const newTime = prev + deltaTime;
          if (newTime >= duration) {
            clearInterval(playIntervalRef.current);
            playIntervalRef.current = null;
            setIsPlaying(false);
            collaborationRef.current?.updateTimeline(duration);
            collaborationRef.current?.releaseTimelineControl();
            return duration;
          }
          collaborationRef.current?.updateTimeline(newTime);
          return newTime;
        });
      }, INTERVAL_MS);
    }
  };

  const handleSeek = (e) => {
    const newTime = parseInt(e.target.value);
    setCurrentTime(newTime);
    collaborationRef.current?.updateTimeline(newTime);
  };

  const handleDragStart = async () => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
    }
    await collaborationRef.current?.requestTimelineControl();
    collaborationRef.current?.startReplay(session.user.email);
  };
  
  const handleDragEnd = () => {
    collaborationRef.current?.stopReplay();
    collaborationRef.current?.releaseTimelineControl();
    if (isPlaying) {
      togglePlayback();
    }
  };

  const reset = async () => {
    await collaborationRef.current?.requestTimelineControl();
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
    }
    setCurrentTime(0);
    collaborationRef.current?.updateTimeline(0);
    collaborationRef.current?.releaseTimelineControl();
  };

  const addNoteAnchor = () => {
    notepadRef.current?.setManualTimestamp();
  };

  const handleTimestampClick = async (timestamp) => {
    if (roomState === 'ARCHIVED') {
      await collaborationRef.current?.requestTimelineControl();
      const seekTime = timestamp - startTimeRef.current;
      setCurrentTime(seekTime);
      collaborationRef.current?.updateTimeline(seekTime);
      collaborationRef.current?.releaseTimelineControl();
    }
  };

  if (status === "loading") {
    return <div>Loading...</div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full items-center justify-center">
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-3 h-3 rounded-full ${
            participants.interviewer ? 'bg-green-500' : 'bg-red-500'
          }`} />
          <span className="text-sm text-gray-600">Interviewer</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-3 h-3 rounded-full ${
            participants.interviewee ? 'bg-green-500' : 'bg-red-500'
          }`} />
          <span className="text-sm text-gray-600">Candidate</span>
        </div>
        <span className="text-sm text-gray-600">
          Room State: {roomState}
        </span>
      </div>

      <h4 className="mb-0 pb-0">
        You are: {role === "interviewer" ? "Interviewer" : "Candidate"}
      </h4>

      <div className="flex flex-col pt-10">
        <div className="flex flex-row gap-5">
          <CodeEditor
            isInterviewActive={roomState === 'ACTIVE'}
            interviewStartTime={startTimeRef.current}
            onOperationsUpdate={handleOperationsUpdate}
            isPlaying={isPlaying}
            onSeek={handleSeek}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            currentTimeOverride={currentTime}
            roomId={roomId}
            userId={session?.user?.email}
            role={role}
            remotePointer={remotePointers}
          />

          {role === 'interviewer' ? (
            <NotePad 
              baseTimeRef={startTimeRef}
              roomState={roomState}
              endTimeRef={endTimeRef}
              ref={notepadRef}
              onTimestampClick={handleTimestampClick}
              currentTime={currentTime}
            />
          ) : (
            <div className="flex flex-col gap-3 overflow-hidden">
              <div className="flex flex-row w-[500px] px-8 py-8 border border-gray-200 rounded-lg bg-white">
                <div className="w-full h-[450px]">
                  Placeholder for candidate view
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 mt-4">
          {roomState === 'CREATED' && role === 'interviewer' && (
            <Button 
              onClick={startInterview}
              disabled={!participants.interviewer || !participants.interviewee}
              variant="default"
            >
              {!participants.interviewer || !participants.interviewee 
                ? "Waiting for both participants..." 
                : "Start Interview"}
            </Button>
          )}

          {roomState === 'ACTIVE' && role === 'interviewer' && (
            <>
              <Button 
                onClick={addNoteAnchor}
                variant="secondary"
              >
                Add Note Anchor
              </Button>
              <Button 
                onClick={endInterview}
                variant="destructive"
              >
                End Interview
              </Button>
            </>
          )}

          {roomState === 'ARCHIVED' && (
            <Timeline
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              isInterviewActive={roomState === 'ACTIVE'}
              operations={operations}
              onSeek={handleSeek}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onTogglePlay={togglePlayback}
              onReset={reset}
              role={role}
              timelineController={timelineController}
              userId={session?.user?.email}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default InterviewRoom;
