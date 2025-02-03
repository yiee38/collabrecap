'use client';

import { useState, useRef, useEffect } from 'react';
import { debounce } from 'lodash';
import { useParams, useRouter } from 'next/navigation';
import { socketService } from '@/lib/socketService';
import CodeEditor from '@/components/CodeEditor';
import VideoChat from '@/components/VideoChat';
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
  const [roomState, setRoomState] = useState('CREATED');
  const [error, setError] = useState(null);
  const [participants, setParticipants] = useState({
    interviewer: { present: false, videoReady: false },
    interviewee: { present: false, videoReady: false }
  });
  const [operations, setOperations] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineController, setTimelineController] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('pending');

  const [archivedNotes, setArchivedNotes] = useState('');
  const [archivedNoteLines, setArchivedNoteLines] = useState([]);
  
  useEffect(() => {
    console.log("Operations state in room:", operations);
  }, [operations]);
  
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
          try {
            const room = await getArchivedRoom(roomId);
            console.log('Found archived room:', room);
            
            setRoomState('ARCHIVED');
            setUploadStatus('complete'); 
            setDuration(room.duration);
            startTimeRef.current = room.startedAt;
            endTimeRef.current = room.endTime;
            const archivedOperations = room.codeOperations || [];
            console.log("Archived operations from server:", archivedOperations);
            setOperations(archivedOperations);
            setArchivedNotes(room.noteContent || '');
            setArchivedNoteLines(room.noteLines || []);
            
            collaborationRef.current = new CollaborationService(roomId, session.user.email, role);
            collaborationRef.current.onTimelineUpdate(({ currentTime, controlledBy }) => {
              if (controlledBy !== session.user.email) {
                setCurrentTime(currentTime);
              }
              setTimelineController(controlledBy);
            });
          } catch (err) {
            if (err?.response?.status !== 404) {
              console.error('Error fetching room:', err);
            }
          }

          await socketService.connect(process.env.NEXT_PUBLIC_SOCKET_URL);

          socketService.onError((error) => {
            console.log('Socket error:', error);
            setError('Room not found');
          });

          socketService.joinRoom(roomId, session.user.email, role);

          socketService.onRoomStatus((room) => {
            setRoomState(room.state);
            if (room.state === 'ACTIVE' && !startTimeRef.current) {
              startTimeRef.current = Date.now();
            } else if (room.state === 'ARCHIVED' && room.endTime) {
              endTimeRef.current = room.endTime;
              setDuration(room.duration || (room.endTime - startTimeRef.current));
            }

            setParticipants(prev => ({
              interviewer: { ...prev.interviewer, present: !!room.roles.interviewer },
              interviewee: { ...prev.interviewee, present: !!room.roles.interviewee }
            }));
          });

          socketService.socket.on('room:ended', ({ endTime, duration }) => {
            endTimeRef.current = endTime;
            setDuration(duration);
            setRoomState('ARCHIVED');
          });

          socketService.socket.on('video:ready', ({ role, ready }) => {
            setParticipants(prev => ({
              ...prev,
              [role]: { ...prev[role], videoReady: ready }
            }));
          });

          collaborationRef.current = new CollaborationService(roomId, session.user.email, role);

          collaborationRef.current.onTimelineUpdate(({ currentTime, controlledBy, isPlaying }) => {
            if (controlledBy !== session.user.email) {
              setCurrentTime(currentTime);
            }
            setTimelineController(controlledBy);
            if (isPlaying !== undefined) {
              setIsPlaying(isPlaying);
            }
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
      const endTime = Date.now();
      const actualDuration = endTime - startTimeRef.current;
      
      await collaborationRef.current?.requestTimelineControl();
      collaborationRef.current?.updateTimeline(actualDuration);
      
      setDuration(actualDuration);
      
          setUploadStatus('uploading');
          socketService.socket.emit('room:end', { 
            roomId, 
            userId: session.user.email,
            operations,
            duration: actualDuration,
            endTime
          });
          
          socketService.socket.once('room:ended', () => {
            setUploadStatus('complete');
          });
          
          collaborationRef.current?.releaseTimelineControl();
    }
  };

  const handleOperationsUpdate = (newOperations, newDuration) => {
    setOperations(newOperations);
    setDuration(newDuration);
  };

  useEffect(() => {
    const playbackController = collaborationRef.current?.yTimeline.get('playbackController');
    const isCurrentController = playbackController === session?.user?.email;

    if (isPlaying && !playIntervalRef.current && isCurrentController) {
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
            collaborationRef.current?.setPlaying(false);
            collaborationRef.current?.updateTimeline(duration);
            collaborationRef.current?.yTimeline.set('playbackController', null);
            return duration;
          }
          
          collaborationRef.current?.updateTimeline(newTime);
          return newTime;
        });
      }, INTERVAL_MS);
    } else if (!isPlaying && playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
      if (isCurrentController) {
        collaborationRef.current?.yTimeline.set('playbackController', null);
      }
    }
  }, [isPlaying, duration, session?.user?.email]);

  const togglePlayback = async () => {
    if (isPlaying) {
      collaborationRef.current?.setPlaying(false);
      return;
    }

    await collaborationRef.current?.requestTimelineControl();
    const startPosition = currentTime >= duration ? 0 : currentTime;
    setCurrentTime(startPosition);
    await collaborationRef.current?.updateTimeline(startPosition);
    collaborationRef.current?.releaseTimelineControl();
    
    collaborationRef.current?.yTimeline.set('playbackController', session.user.email);
    collaborationRef.current?.setPlaying(true);
  };

  const handleSeek = async (e) => {
    if (isPlaying) {
      collaborationRef.current?.setPlaying(false);
      collaborationRef.current?.yTimeline.set('playbackController', null);
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }

    await collaborationRef.current?.requestTimelineControl();
    const newTime = parseInt(e.target.value);
    setCurrentTime(newTime);
    await collaborationRef.current?.updateTimeline(newTime);
    collaborationRef.current?.releaseTimelineControl();
  };

  const handleDragStart = async () => {
    if (isPlaying) {
      collaborationRef.current?.setPlaying(false);
      collaborationRef.current?.yTimeline.set('playbackController', null);
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }

    await collaborationRef.current?.requestTimelineControl();
    collaborationRef.current?.startReplay(session.user.email);
  };
  
  const handleDragEnd = () => {
    collaborationRef.current?.stopReplay();
    collaborationRef.current?.releaseTimelineControl();
  };

  const reset = async () => {
    if (isPlaying) {
      collaborationRef.current?.setPlaying(false);
      collaborationRef.current?.yTimeline.set('playbackController', null);
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }

    await collaborationRef.current?.requestTimelineControl();
    setCurrentTime(0);
    await collaborationRef.current?.updateTimeline(0);
    collaborationRef.current?.releaseTimelineControl();
  };

  const addNoteAnchor = () => {
    notepadRef.current?.setManualTimestamp();
  };

  const handleTimestampClick = async (timestamp) => {
    if (roomState === 'ARCHIVED') {
      if (isPlaying) {
        collaborationRef.current?.setPlaying(false);
        collaborationRef.current?.yTimeline.set('playbackController', null);
        if (playIntervalRef.current) {
          clearInterval(playIntervalRef.current);
          playIntervalRef.current = null;
        }
      }

      await collaborationRef.current?.requestTimelineControl();
      collaborationRef.current?.startReplay(session.user.email);
      
      const seekTime = timestamp - startTimeRef.current;
      setCurrentTime(seekTime);
      await collaborationRef.current?.updateTimeline(seekTime);
      
      collaborationRef.current?.stopReplay();
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

  const bothParticipantsPresent = participants.interviewer.present && participants.interviewee.present;
  const bothVideosReady = participants.interviewer.videoReady && participants.interviewee.videoReady;

  return (
    <div className="flex flex-col w-full h-full items-center justify-center">
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-3 h-3 rounded-full ${
            participants.interviewer.present ? 'bg-green-500' : 'bg-red-500'
          }`} />
          <span className="text-sm text-gray-600">Interviewer</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-3 h-3 rounded-full ${
            participants.interviewee.present ? 'bg-green-500' : 'bg-red-500'
          }`} />
          <span className="text-sm text-gray-600">Candidate</span>
        </div>
        <span className="text-sm text-gray-600">
          Room State: {roomState}
        </span>
        <span className="text-sm text-gray-600">
          You are: {role === "interviewer" ? "Interviewer" : "Candidate"}
        </span>
      </div>

      <div className="flex flex-col items-center gap-4 pt-10">
        <VideoChat 
          roomId={roomId}
          userId={session?.user?.email}
          role={role}
          isInterviewStarted={roomState === 'ACTIVE'}
          currentTime={currentTime}
          isPlaying={isPlaying}
          duration={duration}
          onVideoReady={(ready) => {
            setParticipants(prev => ({
              ...prev,
              [role]: { ...prev[role], videoReady: ready }
            }));
            socketService.socket.emit('video:ready', { 
              roomId,
              role,
              ready 
            });
          }}
        />
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
            initialOperations={operations}
            initialContent=""  
          />

          {role === 'interviewer' ? (
            <NotePad 
              baseTimeRef={startTimeRef}
              roomState={roomState}
              endTimeRef={endTimeRef}
              ref={notepadRef}
              onTimestampClick={handleTimestampClick}
              currentTime={currentTime}
              initialContent={archivedNotes}
              initialNoteLines={archivedNoteLines}
              onSeek={handleSeek}
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

        <div className="flex flex-col gap-2 mt-4 w-full">
          {roomState === 'CREATED' && role === 'interviewer' && (
            <div className='flex flex-row gap-4'>
              <Button 
                onClick={startInterview}
                disabled={!bothParticipantsPresent || !bothVideosReady}
                variant="default"
              >
                {!bothParticipantsPresent 
                  ? "Waiting for both participants..." 
                  :!bothVideosReady
                  ? "Waiting for video setup..."
                  : "Start Interview"}
              </Button>
            </div>
          )}

          {roomState === 'ACTIVE' && role === 'interviewer' && (
            <div className='flex flex-row gap-4'>
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
            </div>
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
              uploadStatus={uploadStatus}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default InterviewRoom;
