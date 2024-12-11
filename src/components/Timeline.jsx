// Timeline.jsx
import React, { useCallback, useRef } from 'react';
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
    maxWidth: '800px',
    margin: '16px auto',
  },
  timeDisplay: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '8px'
  },
  controls: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px'
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
  userId
}) => {
  const seekInProgressRef = useRef(false);
  const lastSeekTimeRef = useRef(0);
  const MIN_SEEK_INTERVAL = 50;

  const formatTime = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
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

  const isControlDisabled = timelineController && timelineController !== userId;

  return (
    <div style={customStyle.timelineContainer}>
      <div style={customStyle.controls}>
        <Button 
          onClick={onTogglePlay} 
          disabled={isControlDisabled}
        >
          {isPlaying ? <FaPause /> : <FaPlay />}
        </Button>
        <Button 
          onClick={onReset} 
          disabled={isControlDisabled}
        >
          <FaArrowRotateLeft />
        </Button>
      </div>

      <div style={customStyle.timeDisplay}>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
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
      
      <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '8px' }}>
        {`Recorded ${operations.length} operations`}
      </div>
      
      {timelineController && timelineController !== userId && (
        <div style={customStyle.statusMessage}>
          Timeline controlled by {role === 'interviewer' ? 'interviewee' : 'interviewer'}
        </div>
      )}
    </div>
  );
};

export default Timeline;