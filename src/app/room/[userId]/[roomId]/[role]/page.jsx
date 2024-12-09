'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { socketService } from '@/lib/socketService';
import CodeEditor from '@/components/CodeEditor';
import Timeline from '@/components/Timeline';
import NotePad from '@/components/Notepad';
import CollaborationService from '@/lib/collaborationService';
import { Button } from 'react-bootstrap';

const INTERVAL_MS = 50;

export default function InterviewRoom() {
  // Get params from Next.js dynamic route
  const params = useParams();
  const roomId = params.roomId;
  const userId = params.userId;
  const role = params.role;

  const [roomState, setRoomState] = useState('CREATED');
  const [isConnected, setIsConnected] = useState(false);
  const [operations, setOperations] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineController, setTimelineController] = useState(null);
  
  const startTimeRef = useRef(null);
  const endTimeRef = useRef(null);
  const playIntervalRef = useRef(null);
  const collaborationRef = useRef(null);
  const lastUpdateRef = useRef(null);

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    overflow: 'hidden'
  };

  const editorContainerStyle = {
    display: 'flex',
    flexDirection: 'row',
    width: '500px',
    padding: '33px 16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: '#fff'
  };

  // Your existing useEffect and other functions remain largely the same
  // Just update socket connection to use environment variables
  useEffect(() => {
    if (!socketService.socket?.connected) {
      socketService.connect(process.env.NEXT_PUBLIC_SOCKET_URL);
    }
    
    socketService.joinRoom(roomId, userId, role);
    
    socketService.onRoomStatus((room) => {
      setRoomState(room.state);
      if (room.state === 'ACTIVE' && !startTimeRef.current) {
        startTimeRef.current = Date.now();
      }
    });

    collaborationRef.current = new CollaborationService(roomId, userId, role);

    collaborationRef.current.onTimelineUpdate(({ currentTime, controlledBy }) => {
      if (controlledBy !== userId) {
        setCurrentTime(currentTime);
      }
      setTimelineController(controlledBy);
    });

    collaborationRef.current.onReplayStateChange(({ isReplaying, controller }) => {
      // Update UI state if needed
    });

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
      collaborationRef.current?.destroy();
      socketService.disconnect();
    };
  }, [roomId, userId, role]);

  const startInterview = () => {
    if (role === 'interviewer') {
      socketService.socket.emit('room:start', { roomId, userId });
      startTimeRef.current = Date.now();
    }
  };

  const endInterview = async () => {    
    if (role === 'interviewer') {
      let newDuration = Date.now() - startTimeRef.current;
      endTimeRef.current = Date.now();
      setDuration(newDuration);
      await collaborationRef.current?.requestTimelineControl();
      collaborationRef.current?.updateTimeline(newDuration);

      socketService.socket.emit('room:end', { 
        roomId, 
        userId,
        operations,
        newDuration 
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
    collaborationRef.current?.startReplay(userId);
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


  return (
    <div className="flex flex-col w-full h-full items-center justify-center">
      <div className="status-bar">
        Room State: {roomState}
      </div>

      <div className="flex flex-col w-full h-full items-center justify-center">
        <h4 className="mb-0 pb-0">
          You are: {role === "interviewer" ? "Interviewer": "Candidate"}
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
              userId={userId}
              role={role}
            />
          {role === 'interviewer' ? (
            <NotePad 
              baseTimeRef={startTimeRef}
              roomState={roomState}
              endTimeRef={endTimeRef}
            />
          ) : (
            <div className="flex flex-col gap-3 overflow-hidden">
              <div className="flex flex-row w-[500px] px-8 py-8 border border-gray-200 rounded-lg bg-white">
                <div className="w-full h-[450px]">
                  "Placeholder for tabs"
                  
                </div>
              </div>
            </div>
          )}

        </div>
        

        {/* Controls */}
        {roomState === 'CREATED' && (
          <Button onClick={startInterview}>Start Interview</Button>
        )}
        {roomState === 'ACTIVE' && (
          <Button onClick={endInterview}>End Interview</Button>
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
            userId={userId}
          />
        )}
        </div>
      </div>
    </div>
  );
}