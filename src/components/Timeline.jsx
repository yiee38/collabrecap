import React, { useCallback, useRef, useState, useEffect } from 'react';
import { FaPlay, FaPause, FaArrowRotateLeft } from "react-icons/fa6";
import { Button } from 'react-bootstrap';
import { debounce } from 'lodash';

const customStyle = {
  statusMessage: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginTop: '8px',
    fontStyle: 'italic'
  },
  timelineContainer: {
    marginTop: '16px',
    width: '100%',
    margin: '16px auto',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8px',
  },
  timeDisplay: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.875rem',
    color: '#6b7280',
  },
  controls: {
    display: 'flex',
    gap: '8px',
  }
};

const Timeline = ({
  currentTime,
  duration,
  isPlaying,
  isInterviewActive,
  operations,
  onSeek,
  onDragStart,
  onDragEnd,
  onTogglePlay,
  onReset,
  role,
  timelineController,
  userId,
  uploadStatus,
  uploadStatuses
}) => {
  const seekInProgressRef = useRef(false);
  const lastSeekTimeRef = useRef(0);
  const MIN_SEEK_INTERVAL = 50;
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekingUser, setSeekingUser] = useState(null);

  const formatTime = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const debouncedSeek = useCallback(
    debounce((value) => {
      if (seekInProgressRef.current) return;
      
      const now = Date.now();
      if (now - lastSeekTimeRef.current < MIN_SEEK_INTERVAL) return;
      
      seekInProgressRef.current = true;
      lastSeekTimeRef.current = now;
      
      try {
        onSeek({ target: { value } });
      } finally {
        setTimeout(() => {
          seekInProgressRef.current = false;
        }, MIN_SEEK_INTERVAL);
      }
    }, 30, { leading: true, trailing: true, maxWait: 100 }),
    [onSeek]
  );

  const handleSeek = (e) => {
    const value = parseInt(e.target.value);
    debouncedSeek(value);
  };

  const handleDragStart = async (e) => {
    debouncedSeek.cancel();
    seekInProgressRef.current = false;
    lastSeekTimeRef.current = 0;
    await onDragStart(e);
  };

  const handleDragEnd = async (e) => {
    await onDragEnd(e);
    debouncedSeek.flush();
  };

  useEffect(() => {
    if (timelineController?.isSeeking !== undefined) {
      setIsSeeking(timelineController.isSeeking);
      setSeekingUser(timelineController.seekingUser);
    }
  }, [timelineController]);

  const isControlDisabled = (isSeeking && seekingUser && seekingUser !== userId) || 
    (isInterviewActive && uploadStatus !== 'complete');

  const getStatusMessage = () => {
    if (isSeeking && seekingUser && seekingUser !== userId) {
      return `Timeline is being controlled by ${role === 'interviewer' ? 'interviewee' : 'interviewer'}`;
    }
    
    if (isInterviewActive && uploadStatus !== 'complete') {
      return 'Waiting for upload to complete...';
    }

    if (!isInterviewActive && uploadStatus === 'incomplete') {
      const missing = [];
      if (!uploadStatuses?.interviewer) missing.push('interviewer');
      if (!uploadStatuses?.interviewee) missing.push('interviewee');
      return `Missing recordings from: ${missing.join(', ')}`;
    }

    return null;
  };

  return (
    <div style={customStyle.timelineContainer}>
      <div style={customStyle.controls}>
        <Button 
          onClick={onTogglePlay} 
          disabled={isControlDisabled}
          title={getStatusMessage()}
        >
          {isPlaying ? <FaPause /> : <FaPlay />}
        </Button>
        <Button 
          onClick={onReset} 
          disabled={isControlDisabled}
          title={getStatusMessage()}
        >
          <FaArrowRotateLeft />
        </Button>
      </div>

      <div style={customStyle.timeDisplay}>
        <span>{formatTime(currentTime)}/{formatTime(duration)}</span>
      </div>
      
      <input
        type="range"
        min="0"
        max={duration}
        value={currentTime}
        onChange={handleSeek}
        onMouseDown={handleDragStart}
        onMouseUp={handleDragEnd}
        onTouchStart={handleDragStart}
        onTouchEnd={handleDragEnd}
        disabled={isControlDisabled}
        style={{ width: '100%' }}
      />
      {getStatusMessage() && (
        <div style={customStyle.statusMessage}>
          {getStatusMessage()}
        </div>
      )}
    </div>
  );
};

export default Timeline;
