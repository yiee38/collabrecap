// Timeline.jsx
import React from 'react';
import { FaPlay, FaPause, FaArrowRotateLeft } from "react-icons/fa6";
import { Button } from 'react-bootstrap';



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
  const formatTime = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  };

  const renderControllerInfo = () => {
    if (!timelineController) return null;
    if (timelineController === userId) return null;
    
    // Get the role of the controller (opposite of current user's role)
    const controllerRole = role === 'interviewer' ? 'interviewee' : 'interviewer';
    return (
      <div style={customStyle.controllerInfo}>
        Timeline controlled by {controllerRole}
      </div>
    );
  };

  return (
    <div style={customStyle.timelineContainer}>
      

      {/* Controls */}
      <div style={customStyle.controls}>
        <Button onClick={onTogglePlay } disabled={timelineController && timelineController !== userId}
        >
          {isPlaying ? <FaPause /> : <FaPlay />}
        </Button>
        <Button onClick={onReset} disabled={timelineController && timelineController !== userId}
        >
          <FaArrowRotateLeft />
        </Button>
      </div>


      
        <>
          <div style={customStyle.timeDisplay}>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          <input
            type="range"
            min="0"
            max={duration}
            value={currentTime}
            onChange={onSeek}
            onMouseDown={onDragStart}
            onMouseUp={onDragEnd}
            onTouchStart={onDragStart}
            onTouchEnd={onDragEnd}
            disabled={timelineController && timelineController !== userId}
            style={{ width: '100%' }}
          />
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '8px' }}>
            {`Recorded ${operations.length} operations`}
          </div>
          {renderControllerInfo()}
        </>
      
    </div>
  );
};

export default Timeline;