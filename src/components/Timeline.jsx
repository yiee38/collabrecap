import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
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
  },
  disabledButton: {
    opacity: '0.5',
    cursor: 'not-allowed',
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

  const isControlDisabled = useMemo(() => {
    console.log('Checking isControlDisabled:');
    console.log('- isInterviewActive:', isInterviewActive);
    console.log('- uploadStatus:', uploadStatus);
    console.log('- isSeeking:', isSeeking);
    console.log('- seekingUser:', seekingUser);
    
    if (isSeeking && seekingUser !== userId) {
      console.log('Controls disabled: Another user is seeking');
      return true;
    }
    
    if (isInterviewActive) {
      const isUploading = uploadStatus && (
        uploadStatus === 'uploading' || 
        uploadStatus === 'uploading_final' || 
        uploadStatus === 'preparing_final' ||
        uploadStatus.startsWith('retrying_upload_')
      );
      
      console.log('Interview active, uploading:', isUploading);
      return isUploading;
    }

    const isLoading = uploadStatus === 'loading_videos' || 
                      uploadStatus === 'Loading recordings...' || 
                      uploadStatus === 'pending' ||
                      uploadStatus === 'processing_recordings';
    
    const isUploading = uploadStatus === 'uploading' || 
                        uploadStatus === 'uploading_final' || 
                        uploadStatus === 'preparing_final' ||
                        uploadStatus.startsWith('retrying_upload_');
    
    const isFailure = uploadStatus && (
      uploadStatus.includes('failed') || 
      uploadStatus.includes('corrupted')
    );
    
    const isComplete = !uploadStatus || 
                       uploadStatus === '' || 
                       uploadStatus === 'complete';
    
    console.log('Status checks:', {
      isLoading,
      isUploading,
      isFailure,
      isComplete
    });
    
    return isLoading || isUploading || isFailure;
  }, [isInterviewActive, uploadStatus, isSeeking, seekingUser, userId]);

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
    setTimeout(() => {
      debouncedSeek.flush();
    }, 30);
  };

  useEffect(() => {
    if (timelineController?.isSeeking !== undefined) {
      setIsSeeking(timelineController.isSeeking);
      setSeekingUser(timelineController.seekingUser);
    }
  }, [timelineController]);

  useEffect(() => {
    console.log('Timeline Debug:');
    console.log('- isInterviewActive:', isInterviewActive);
    console.log('- uploadStatus:', uploadStatus);
    console.log('- isControlDisabled:', isControlDisabled);
    console.log('- isSeeking:', isSeeking);
    console.log('- seekingUser:', seekingUser);
    console.log('- Condition 1:', (isSeeking && seekingUser && seekingUser !== userId));
    console.log('- Condition 2:', (isInterviewActive && uploadStatus !== 'complete'));
    console.log('- Condition 3:', (!isInterviewActive && (
      uploadStatus === 'loading_videos' ||
      uploadStatus === 'Loading recordings...' || 
      uploadStatus === 'pending' ||
      uploadStatus === 'uploading' ||
      uploadStatus === 'uploading_final' ||
      uploadStatus === 'preparing_final' ||
      uploadStatus.startsWith('retrying_upload_')
    )));
    
    if (!isInterviewActive) {
      console.log('- Is loading_videos?', uploadStatus === 'loading_videos');
      console.log('- Is Loading recordings...?', uploadStatus === 'Loading recordings...');
      console.log('- Is pending?', uploadStatus === 'pending');
      console.log('- Is uploading?', uploadStatus === 'uploading');
      console.log('- Is uploading_final?', uploadStatus === 'uploading_final');
      console.log('- Is preparing_final?', uploadStatus === 'preparing_final');
      console.log('- Starts with retrying_upload_?', uploadStatus?.startsWith('retrying_upload_'));
    }
  }, [isInterviewActive, uploadStatus, isControlDisabled, isSeeking, seekingUser, userId]);
  
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
    
    if (!isInterviewActive && uploadStatus === 'uploading') {
      return 'Processing recordings...';
    }
    
    if (!isInterviewActive && uploadStatus === 'uploading_final') {
      return 'Uploading final recording...';
    }
    
    if (!isInterviewActive && uploadStatus === 'preparing_final') {
      return 'Preparing final recording...';
    }
    
    if (!isInterviewActive && uploadStatus === 'processing_recordings') {
      return 'Processing recordings... Please wait';
    }
    
    if (!isInterviewActive && uploadStatus.startsWith('retrying_upload_')) {
      const attempt = uploadStatus.replace('retrying_upload_', '');
      return `Retrying upload (${attempt}/3)...`;
    }
    
    if (!isInterviewActive && (uploadStatus === 'pending' || uploadStatus === 'loading_videos')) {
      return 'Loading video recordings...';
    }

    if (!isInterviewActive && uploadStatus && (
      uploadStatus.startsWith('failed_to_load') || 
      uploadStatus.includes('failed')
    )) {
      if (uploadStatus.startsWith('failed_to_load:')) {
        return `Failed to load recordings: ${uploadStatus.replace('failed_to_load:', '').trim()}`;
      }
      return uploadStatus;
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
          style={isControlDisabled ? customStyle.disabledButton : {}}
        >
          {isPlaying ? <FaPause /> : <FaPlay />}
        </Button>
        <Button 
          onClick={onReset} 
          disabled={isControlDisabled}
          title={getStatusMessage()}
          style={isControlDisabled ? customStyle.disabledButton : {}}
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
