'use client';

import { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import { socketService } from '@/lib/socketService';

const VideoChat = ({ 
  roomId, 
  userId, 
  role, 
  onVideoReady, 
  isInterviewStarted,
  currentTime,
  isPlaying,
  duration,
  onUploadStatusChange 
}) => {
  const [peer, setPeer] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isLocalStreamReady, setIsLocalStreamReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [recordings, setRecordings] = useState({ local: null, remote: null });
  const [isRecordingsMuted, setIsRecordingsMuted] = useState(false);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('initializing');
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localRecordingRef = useRef(null);
  const remoteRecordingRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const connectionMonitorRef = useRef(null);
  const lastConnectionCheckRef = useRef(Date.now());
  const [videoReady, setVideoReady] = useState({
    local: false,
    remote: false
  });


  useEffect(() => {
    console.log('VideoChat component mounted, cleaning up any existing connections');
    
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia({ audio: true, video: true })
        .then(stream => {
          stream.getTracks().forEach(track => track.stop());
          console.log('Stopped all newly requested tracks');
        })
        .catch(err => {
          console.log('Could not get dummy stream for cleanup:', err.name);
        });
    }
    
    return () => {
      console.log('VideoChat component unmounting, cleaning up connections');
    };
  }, []);

  useEffect(() => {
    if (!isInterviewStarted && (localRecordingRef.current || remoteRecordingRef.current)) {
      const playVideo = async (video) => {
        if (!video) return;
        try {
          if (currentTime === 0 && video.currentTime >= duration / 1000) {
            video.currentTime = 0;
          }
          
          video.muted = isRecordingsMuted;
          if (isPlaying) {
            await video.play().catch(() => {
              video.muted = true;
              return video.play();
            });
          } else {
            video.pause();
          }
        } catch (err) {
          console.log('Could not control video:', err);
        }
      };

      if (videoReady.local) {
        playVideo(localRecordingRef.current);
      }
      if (videoReady.remote) {
        playVideo(remoteRecordingRef.current);
      }
    }
  }, [isPlaying, isInterviewStarted, currentTime, duration, videoReady]);

  useEffect(() => {
    if (!isInterviewStarted && !isPlaying && (localRecordingRef.current || remoteRecordingRef.current)) {
      const setVideoTime = (video) => {
        if (!video) return;
        video.currentTime = currentTime / 1000;
      };

      setVideoTime(localRecordingRef.current);
      setVideoTime(remoteRecordingRef.current);
    }
  }, [currentTime, isInterviewStarted, isPlaying]);

  useEffect(() => {
    if (!isInterviewStarted && (localRecordingRef.current || remoteRecordingRef.current)) {
      const initVideo = (video) => {
        if (!video) return;
        video.currentTime = currentTime / 1000;
        
        const onTimeUpdate = () => {
          if (isPlaying && Math.abs(video.currentTime - currentTime / 1000) > 0.5) {
            video.currentTime = currentTime / 1000;
          }
        };

        video.addEventListener('timeupdate', onTimeUpdate);
        return () => video.removeEventListener('timeupdate', onTimeUpdate);
      };
      setVideoReady({
        local: false,
        remote: false
      });

      const cleanupLocal = initVideo(localRecordingRef.current);
      const cleanupRemote = initVideo(remoteRecordingRef.current);

      return () => {
        cleanupLocal?.();
        cleanupRemote?.();
      };
    }
  }, [isInterviewStarted]);

  useEffect(() => {
    setVideoReady({
      local: false,
      remote: false
    });
  }, [recordings]);

  useEffect(() => {
    const handleMuteStateChange = ({ isMuted, userId: senderId }) => {
      console.log(`Received mute state change from user ${senderId}:`, isMuted);
      setIsRecordingsMuted(isMuted);
      
      if (localRecordingRef.current) {
        localRecordingRef.current.muted = isMuted;
      }
      if (remoteRecordingRef.current) {
        remoteRecordingRef.current.muted = isMuted;
      }
    };

    socketService.onMuteStateChange(handleMuteStateChange);

    return () => {
      if (socketService.socket) {
        socketService.socket.off('video:mute:receive', handleMuteStateChange);
      }
    };
  }, []);

  const handleMuteToggle = () => {
    const newMuteState = !isRecordingsMuted;
    setIsRecordingsMuted(newMuteState);
    
    if (localRecordingRef.current) {
      localRecordingRef.current.muted = newMuteState;
    }
    if (remoteRecordingRef.current) {
      remoteRecordingRef.current.muted = newMuteState;
    }
    
    socketService.shareMuteState(roomId, newMuteState, userId);
  };

  useEffect(() => {
    if (!isInterviewStarted) {
      const monitorConnection = () => {
        const currentTime = Date.now();
        
        if (currentTime - lastConnectionCheckRef.current < 10000) {
          return;
        }
        
        lastConnectionCheckRef.current = currentTime;
        
        if (peer && peer.disconnected) {
          console.log('Peer is disconnected, attempting to reconnect...');
          setConnectionStatus('reconnecting');
          
          setTimeout(() => {
            if (peer && peer.disconnected) {
              initPeer(0);
            }
          }, 2000);
        } else {
          if (connectionStatus !== 'connected') {
            console.log('Connection is healthy, setting status to connected');
            setConnectionStatus('connected');
            onVideoReady(true);
            
            if (socketService.socket?.connected) {
              socketService.socket.emit('video:ready', { 
                roomId,
                role,
                ready: true 
              });
            }
          }
        }
      };
      
      console.log('Setting up connection monitoring (interview not started)');
      connectionMonitorRef.current = setInterval(monitorConnection, 10000);
      
      return () => {
        if (connectionMonitorRef.current) {
          console.log('Clearing connection monitoring');
          clearInterval(connectionMonitorRef.current);
          connectionMonitorRef.current = null;
        }
      };
    } else if (connectionMonitorRef.current) {
      console.log('Interview started, clearing connection monitoring');
      clearInterval(connectionMonitorRef.current);
      connectionMonitorRef.current = null;
    }
  }, [isInterviewStarted, peer, roomId, role, connectionStatus]);

  const fetchRecordings = async (retryCount = 0) => {
    try {
      setUploadStatus(retryCount > 0 ? 'processing_recordings' : 'loading_videos');
      console.log(`Fetching recordings for room: ${roomId} (attempt: ${retryCount + 1})`);
      
      const res = await fetch(`/api/cloudinary/recordings?roomId=${roomId}`);
      
      if (!res.ok) {
        let errorData;
        try {
          errorData = await res.json();
        } catch (parseError) {
          console.error('Error parsing error response:', parseError);
          errorData = { 
            error: `HTTP ${res.status}: ${res.statusText}`,
            message: 'Could not parse error response'
          };
        }
        
        console.error('Failed to fetch recordings:', {
          status: res.status,
          statusText: res.statusText,
          error: errorData.error,
          message: errorData.message,
          details: errorData.details
        });
        
        if (res.status === 404 && uploadStatus && (
            uploadStatus === 'uploading' || 
            uploadStatus === 'uploading_final' || 
            uploadStatus === 'preparing_final' ||
            uploadStatus === 'upload_complete' ||
            uploadStatus === 'processing_recordings' ||
            uploadStatus.startsWith('retrying_upload_')
          )) {
          console.log('Recordings not yet available, still processing...');
          setUploadStatus('processing_recordings');
          
          const retryDelay = Math.min(3000 + (retryCount * 2000), 15000);
          console.log(`Will retry in ${retryDelay/1000} seconds (attempt ${retryCount + 1})`);
          
          setTimeout(() => {
            fetchRecordings(retryCount + 1);
          }, retryDelay);
          return;
        }
        
        setUploadStatus(`failed_to_load: ${errorData.error || res.statusText}`);
        return;
      }
      
      let data;
      try {
        data = await res.json();
      } catch (parseError) {
        console.error('Error parsing recordings response:', parseError);
        setUploadStatus('failed_to_load: Invalid response format');
        return;
      }
      
      if (!data.recordings || !Array.isArray(data.recordings)) {
        console.error('Unexpected response format:', data);
        setUploadStatus('failed_to_load: Invalid recordings data');
        return;
      }
      
      console.log(`Found ${data.recordings.length} recordings:`, 
        data.recordings.map(r => `${r.role} (${Math.round(r.size/1024)}KB)`).join(', ')
      );
      
      const localRec = data.recordings.find(r => r.role === role);
      const remoteRec = data.recordings.find(r => r.role !== role);
      
      console.log('Local recording:', localRec ? 
        `Found (${localRec.filename}, ${Math.round(localRec.size/1024)}KB)` : 
        'Not found');
      
      console.log('Remote recording:', remoteRec ? 
        `Found (${remoteRec.filename}, ${Math.round(remoteRec.size/1024)}KB)` : 
        'Not found');
      
      if (!localRec && !remoteRec) {
        console.error('No recordings found for this room');
        
        if (uploadStatus && (
            uploadStatus === 'uploading' || 
            uploadStatus === 'uploading_final' || 
            uploadStatus === 'preparing_final' ||
            uploadStatus === 'upload_complete' ||
            uploadStatus === 'processing_recordings' ||
            uploadStatus.startsWith('retrying_upload_')
          )) {
          console.log('Recordings not yet available, still processing...');
          setUploadStatus('processing_recordings');
          
          const retryDelay = Math.min(3000 + (retryCount * 2000), 15000);
          console.log(`Will retry in ${retryDelay/1000} seconds (attempt ${retryCount + 1})`);
          
          setTimeout(() => {
            fetchRecordings(retryCount + 1);
          }, retryDelay);
          return;
        }
        
        if (retryCount >= 5) {
          setUploadStatus('failed_to_load: No recordings found');
        } else {
          console.log('No recordings found yet, but not showing error as we may still be processing');
          setUploadStatus('processing_recordings');
          
          const retryDelay = Math.min(3000 + (retryCount * 2000), 15000);
          setTimeout(() => {
            fetchRecordings(retryCount + 1);
          }, retryDelay);
        }
        return;
      }
      
      if (localRec && localRec.size < 1000) {
        console.error('Local recording appears to be corrupted (too small)');
        localRec.corrupted = true;
      }
      
      if (remoteRec && remoteRec.size < 1000) {
        console.error('Remote recording appears to be corrupted (too small)');
        remoteRec.corrupted = true;
      }
      
      if ((localRec?.corrupted || !localRec) && (remoteRec?.corrupted || !remoteRec)) {
        console.error('All available recordings are corrupted');
        setUploadStatus('failed_to_load: All recordings are corrupted or missing');
        return;
      }
      
      setRecordings({ 
        local: localRec || null, 
        remote: remoteRec || null 
      });
      
      setUploadStatus('');
    } catch (err) {
      console.error('Error fetching recordings:', err);
      
      if (uploadStatus && (
          uploadStatus === 'uploading' || 
          uploadStatus === 'uploading_final' || 
          uploadStatus === 'preparing_final' ||
          uploadStatus === 'upload_complete' ||
          uploadStatus === 'processing_recordings' ||
          uploadStatus.startsWith('retrying_upload_')
        )) {
        console.log('Error fetching recordings during processing, will retry...');
        setUploadStatus('processing_recordings');
        
        setTimeout(() => {
          fetchRecordings();
        }, 3000);
        return;
      }
      
      setUploadStatus('failed_to_load: Error loading recordings');
    }
  };

  useEffect(() => {
    if (!isInterviewStarted) {
      if (duration > 0) {
        if (!recordings.local && !recordings.remote) {
          setUploadStatus('loading_videos');
        }
        fetchRecordings();
      }
    } else {
      setRecordings({ local: null, remote: null });
      setUploadStatus('');
    }
  }, [roomId, isInterviewStarted, duration]);

  useEffect(() => {
    if (!isInterviewStarted && (recordings.local || recordings.remote)) {
      const preloadVideo = (videoId) => {
        if (!videoId) return;
        
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'video';
        link.href = `/api/recordings/stream/${videoId}`;
        link.setAttribute('fetchpriority', 'low');
        document.head.appendChild(link);
        
        return () => {
          document.head.removeChild(link);
        };
      };
      
      const cleanupLocal = recordings.local ? preloadVideo(recordings.local.id) : null;
      const cleanupRemote = recordings.remote ? preloadVideo(recordings.remote.id) : null;
      
      return () => {
        cleanupLocal?.();
        cleanupRemote?.();
      };
    }
  }, [isInterviewStarted, recordings]);

  /* Back up of video error handling */
  /*
  const handleVideoError = async (videoRef, recordingId, isLocal) => {
    console.error(`Error loading ${isLocal ? 'local' : 'remote'} video`);
    
    try {
      const res = await fetch(`/api/recordings/check/${recordingId}`);
      const data = await res.json();
      
      if (data.exists) {
        if (videoRef.current) {
          videoRef.current.load();
        }
      } else {
        console.error(`Recording ${recordingId} does not exist on the server`);
        setUploadStatus(`${isLocal ? 'Local' : 'Remote'} recording not found on server`);
      }
    } catch (err) {
      console.error('Failed to check recording:', err);
    }
  };
  */

  useEffect(() => {
    const initPeer = async (retryCount = 0) => {
      try {
        if (peer) {
          try {
            console.log('Cleaning up existing peer connection');
            peer.destroy();
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (err) {
            console.error('Error destroying peer:', err);
          }
        }

        const uniqueId = `${roomId}-${role}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        console.log('Creating peer with unique ID:', uniqueId);
        
        setConnectionStatus('connecting');
        const peerConfig = process.env.NODE_ENV === 'production' ? {
          host: window.location.hostname,
          path: '/peerService/peer',
          secure: window.location.protocol === 'https:',
          debug: 2 
        } : {
          host: 'localhost',
          port: 9000,
          path: '/peer',
          debug: 2
        };
      
        const newPeer = new Peer(uniqueId, peerConfig);

        newPeer.on('open', async (id) => {
          console.log('Connected to peer server with ID:', id);
          setConnectionStatus('establishing');
          
          try {
            if (localVideoRef.current?.srcObject) {
              localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
              localVideoRef.current.srcObject = null;
            }
            
            const stream = await navigator.mediaDevices.getUserMedia({ 
              video: {
                width: { ideal: 426, max: 640 },
                height: { ideal: 320, max: 480 },
                frameRate: { ideal: 12, max: 15 }
              }, 
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 22050,
                channelCount: 1
              }
            });
            
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = stream;
              localVideoRef.current.onloadedmetadata = () => {
                localVideoRef.current.play().catch(e => console.log('Could not auto-play local video:', e));
              };
              setIsLocalStreamReady(true);
              
              const pingInterval = setInterval(() => {
                if (socketService.socket?.connected) {
                  socketService.socket.emit('video:ready', { 
                    roomId,
                    role,
                    ready: true 
                  });
                  if (stream && stream.getVideoTracks()[0]) {
                    const track = stream.getVideoTracks()[0];
                    if (track.readyState === 'ended') {
                      console.log('Video track ended, requesting new stream');
                      initPeer(0);
                      clearInterval(pingInterval);
                    }
                  }
                }
              }, 5000);
              
              newPeer.pingInterval = pingInterval;
              
              onVideoReady(true);
              setConnectionStatus('connected');
            }

            const otherRole = role === 'interviewer' ? 'interviewee' : 'interviewer';
            
            console.log('Listening for peers in room', roomId);
            newPeer.on('connection', (conn) => {
              console.log('Received connection from peer:', conn.peer);
            });
            
            socketService.socket.emit('room:peer_present', { 
              roomId, 
              peerId: uniqueId,
              role,
              userId 
            });
            
            const handleRemotePeer = (remotePeerData) => {
              if (remotePeerData.role !== role) {
                console.log('Found remote peer:', remotePeerData);
                try {
                  const call = newPeer.call(remotePeerData.peerId, stream);
                  if (call) {
                    call.on('stream', (remoteVideoStream) => {
                      console.log('Received remote stream');
                      if (remoteVideoRef.current) {
                        remoteVideoRef.current.srcObject = remoteVideoStream;
                        remoteVideoRef.current.onloadedmetadata = () => {
                          remoteVideoRef.current.play().catch(e => console.log('Could not auto-play remote video:', e));
                        };
                        setRemoteStream(remoteVideoStream);
                        onVideoReady(true);
                        setConnectionStatus('connected');
                      }
                    });
                  }
                } catch (err) {
                  console.error('Error calling remote peer:', err);
                }
              }
            };
            
            socketService.socket.on('room:peer_info', handleRemotePeer);
            
            socketService.socket.emit('room:get_peers', { roomId });
            
            newPeer.remotePeerHandler = handleRemotePeer;
            
          } catch (err) {
            console.error('Error accessing media devices:', err);
            onVideoReady(false);
            setConnectionStatus('error');
          }
        });

        newPeer.on('error', (err) => {
          console.error('Peer connection error:', err);
          setConnectionStatus('error');
          
          if (err.type === 'unavailable-id' && retryCount < 3) {
            console.log(`Retrying peer connection in 2 seconds... (attempt ${retryCount + 1})`);
            setTimeout(() => initPeer(retryCount + 1), 2000);
            return;
          }
          
          onVideoReady(false);
        });

        newPeer.on('disconnected', () => {
          console.log('Peer disconnected, attempting to reconnect...');
          setConnectionStatus('reconnecting');
          newPeer.reconnect();
        });

        newPeer.on('call', async (call) => {
          console.log('Received call from:', call.peer);
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
              video: {
                width: { ideal: 426, max: 640 },
                height: { ideal: 320, max: 480 },
                frameRate: { ideal: 12, max: 15 }
              }, 
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 22050,
                channelCount: 1
              }
            });
            
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = stream;
              localVideoRef.current.onloadedmetadata = () => {
                localVideoRef.current.play().catch(e => console.log('Could not auto-play local video:', e));
              };
              setIsLocalStreamReady(true);
              onVideoReady(true);
              setConnectionStatus('connected');
            }
            
            call.answer(stream);
            call.on('stream', (remoteVideoStream) => {
              console.log('Received remote stream from call');
              if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = remoteVideoStream;
                remoteVideoRef.current.onloadedmetadata = () => {
                  remoteVideoRef.current.play().catch(e => console.log('Could not auto-play remote video:', e));
                };
                setRemoteStream(remoteVideoStream);
                onVideoReady(true);
                setConnectionStatus('connected');
              }
            });
          } catch (err) {
            console.error('Error answering call:', err);
            onVideoReady(false);
            setConnectionStatus('error');
          }
        });

        setPeer(newPeer);
      } catch (error) {
        console.error('Error in initPeer:', error);
        setConnectionStatus('error');
        if (retryCount < 3) {
          console.log(`Retrying peer connection in 2 seconds... (attempt ${retryCount + 1})`);
          setTimeout(() => initPeer(retryCount + 1), 2000);
        }
      }
    };

    initPeer(0);

    return () => {
      const cleanup = async () => {
        try {
          if (localVideoRef.current?.srcObject) {
            try {
              localVideoRef.current.srcObject.getTracks().forEach(track => {
                try {
                  track.stop();
                } catch (e) {
                  console.error('Error stopping local track:', e);
                }
              });
              localVideoRef.current.srcObject = null;
            } catch (e) {
              console.error('Error cleaning up local video:', e);
            }
          }
          
          if (remoteVideoRef.current?.srcObject) {
            try {
              remoteVideoRef.current.srcObject.getTracks().forEach(track => {
                try {
                  track.stop();
                } catch (e) {
                  console.error('Error stopping remote track:', e);
                }
              });
              remoteVideoRef.current.srcObject = null;
            } catch (e) {
              console.error('Error cleaning up remote video:', e);
            }
          }
          
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
          
          if (audioContextRef.current) {
            try {
              audioContextRef.current.close();
              audioContextRef.current = null;
            } catch (e) {
              console.error('Error closing audio context:', e);
            }
          }
          
          if (peer) {
            if (peer.pingInterval) {
              clearInterval(peer.pingInterval);
            }
            
            if (peer.remotePeerHandler && socketService.socket) {
              try {
                socketService.socket.off('room:peer_info', peer.remotePeerHandler);
              } catch (e) {
                console.error('Error removing socket listener:', e);
              }
            }
            
            try {
              peer.destroy();
            } catch (e) {
              console.error('Error destroying peer in cleanup:', e);
            }
          }
          
          if (connectionMonitorRef.current) {
            clearInterval(connectionMonitorRef.current);
            connectionMonitorRef.current = null;
          }
          
          setIsLocalStreamReady(false);
          setRemoteStream(null);
          onVideoReady(false);
          setConnectionStatus('disconnected');
        } catch (error) {
          console.error('Error during VideoChat cleanup:', error);
        }
      };
      
      cleanup();
    };
  }, [roomId, role, userId]);

  useEffect(() => {
    const handleBeforeUnload = async (e) => {
      if (isRecording && recordedChunksRef.current.length > 0) {
        e.preventDefault();
        e.returnValue = '';
        
        const finalChunks = [...recordedChunksRef.current];
        recordedChunksRef.current = [];
        await uploadChunks(finalChunks, true);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isRecording]);

  useEffect(() => {
    console.log('Recording effect triggered:', {
      isInterviewStarted,
      isRecording,
      hasLocalStream: !!localVideoRef.current?.srcObject,
      hasRemoteStream: !!remoteVideoRef.current?.srcObject,
      role,
      roomId
    });
    
    if (isInterviewStarted && !isRecording && localVideoRef.current?.srcObject) {
      console.log(`${role}: Starting recording with local stream available, remote stream:`, !!remoteVideoRef.current?.srcObject);
      startRecording();
    } else if (!isInterviewStarted && isRecording) {
      console.log(`${role}: Stopping recording because interview ended`);
      stopRecording();
    }
  }, [isInterviewStarted, isRecording]);

  const uploadChunks = async (chunks, isFinal = false, retryCount = 0) => {
    if (!chunks || chunks.length === 0) {
      console.warn(`${role}: No chunks to upload`);
      return;
    }
    
    const blob = new Blob(chunks, { type: 'video/webm' });
    const chunkSizeKB = Math.round(blob.size/1024);
    
    console.log(`${role}: Preparing to upload ${isFinal ? 'FINAL' : 'intermediate'} recording: ${chunkSizeKB}KB`);
    
    if (blob.size < 1000) { // 1KB minimum
      console.warn(`${role}: Blob too small to be a valid recording, skipping upload`);
      return;
    }
    
    try {
      setUploadStatus(isFinal ? 'uploading_final' : 'uploading');
      
      const formData = new FormData();
      formData.append('file', blob, `recording-${roomId}-${role}-${Date.now()}.webm`);
      formData.append('roomId', roomId);
      formData.append('userId', userId);
      formData.append('role', role);
      formData.append('isFinal', isFinal.toString());
      
      formData.append('partIndex', '0');
      formData.append('totalParts', '1');
      
      console.log(`${role}: Uploading to server...`);
      
      const uploadResponse = await fetch('/api/cloudinary/server-upload', {
        method: 'POST',
        body: formData
      });
      
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error(`${role}: Server upload error:`, uploadResponse.status, errorText);
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (parseErr) {
          errorData = { error: 'Invalid response format', message: errorText };
        }
        
        throw new Error(`Upload failed: ${errorData.error || 'Unknown error'} - ${errorData.message || ''}`);
      }
      
      const uploadResult = await uploadResponse.json();
      
      if (uploadResult.intermediate) {
        console.log(`${role}: Server acknowledged intermediate upload`);
        setUploadStatus('');
        return;
      }
      
      console.log(`${role}: Upload successful:`, uploadResult.url, `(${Math.round(uploadResult.bytes/1024)}KB)`);
      
      if (isFinal) {
        setUploadStatus('upload_complete');
        
        console.log(`${role}: Emitting upload:status complete to room ${roomId}`);
        socketService.socket.emit('upload:status', {
          roomId,
          role,
          status: 'complete',
          videoUrl: uploadResult.url,
          publicId: uploadResult.publicId,
          displayName: uploadResult.displayName
        });
        
        const fileSize = Math.round(uploadResult.bytes/1024/1024); 
        const delayTime = Math.min(Math.max(fileSize * 200, 2000), 10000); // 200ms per mb
        
        console.log(`${role}: Large video detected (${fileSize}MB). Waiting ${delayTime}ms before fetching recordings...`);
        setUploadStatus('processing_recordings');
        
        setTimeout(() => {
          fetchRecordings();
        }, delayTime);
      } else {
        setUploadStatus('');
      }
    } catch (error) {
      console.error(`${role}: Error uploading to server:`, error);
      
      if (retryCount < 3) {
        console.log(`${role}: Retrying upload (attempt ${retryCount + 1} of 3)...`);
        setUploadStatus(`retrying_upload_${retryCount + 1}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return uploadChunks(chunks, isFinal, retryCount + 1);
      }
      
      if (isFinal) {
        setUploadStatus('upload_failed');
        console.log(`${role}: Emitting upload:status failed to room ${roomId}`);
        socketService.socket.emit('upload:status', {
          roomId,
          role,
          status: 'failed',
          error: error.message
        });
      } else {
        setUploadStatus('');
      }
    }
  };

  const startRecording = () => {
    try {
      recordedChunksRef.current = [];
      
      const localStream = localVideoRef.current?.srcObject;
      const remoteStream = remoteVideoRef.current?.srcObject;
      
      if (!localStream) {
        console.error('Local video stream not ready for recording');
        setUploadStatus('recording_failed');
        return;
      }

      console.log(`Starting recording with local stream: ${!!localStream}, remote stream: ${!!remoteStream}`);

      const processedTracks = [];
      
      const localVideoTrack = localStream.getVideoTracks()[0];
      const remoteVideoTrack = remoteStream?.getVideoTracks()[0];
      
      if (localVideoTrack) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 320; 
          canvas.height = 240;
          const ctx = canvas.getContext('2d');
          
          const videoElem = document.createElement('video');
          videoElem.srcObject = new MediaStream([localVideoTrack]);
          videoElem.autoplay = true;
          
          const drawVideo = () => {
            if (videoElem.videoWidth) {
              ctx.drawImage(videoElem, 0, 0, canvas.width, canvas.height);
              requestAnimationFrame(drawVideo);
            } else {
              setTimeout(() => requestAnimationFrame(drawVideo), 100);
            }
          };
          drawVideo();
          
          const processedTrack = canvas.captureStream(10).getVideoTracks()[0];
          processedTracks.push(processedTrack);
        } catch (err) {
          console.warn('Error processing local video, using original track', err);
          processedTracks.push(localVideoTrack);
        }
      }
      
      if (remoteVideoTrack) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 320;  
          canvas.height = 240; 
          const ctx = canvas.getContext('2d');
          
          const videoElem = document.createElement('video');
          videoElem.srcObject = new MediaStream([remoteVideoTrack]);
          videoElem.autoplay = true;
          
          const drawVideo = () => {
            if (videoElem.videoWidth) {
              ctx.drawImage(videoElem, 0, 0, canvas.width, canvas.height);
              requestAnimationFrame(drawVideo);
            } else {
              setTimeout(() => requestAnimationFrame(drawVideo), 100);
            }
          };
          drawVideo();
          
          const processedTrack = canvas.captureStream(10).getVideoTracks()[0];
          processedTracks.push(processedTrack);
        } catch (err) {
          console.warn('Error processing remote video, using original track', err);
          processedTracks.push(remoteVideoTrack);
        }
      } else {
        console.warn('Remote video track not available, recording with local stream only');
        
        try {
          const placeholderCanvas = document.createElement('canvas');
          placeholderCanvas.width = 320;
          placeholderCanvas.height = 240;
          const placeholderCtx = placeholderCanvas.getContext('2d');
          
          const drawPlaceholder = () => {
            placeholderCtx.fillStyle = '#1a1a1a';
            placeholderCtx.fillRect(0, 0, 320, 240);
            placeholderCtx.fillStyle = '#666';
            placeholderCtx.font = '14px Arial';
            placeholderCtx.textAlign = 'center';
            placeholderCtx.fillText('Waiting for participant...', 160, 120);
            requestAnimationFrame(drawPlaceholder);
          };
          drawPlaceholder();
          
          const placeholderTrack = placeholderCanvas.captureStream(1).getVideoTracks()[0];
          processedTracks.push(placeholderTrack);
        } catch (placeholderErr) {
          console.warn('Error creating placeholder video track:', placeholderErr);
        }
      }

      const audioTracks = [
        ...localStream.getAudioTracks(),
        ...(remoteStream?.getAudioTracks() || [])
      ];
      
      const combinedStream = new MediaStream([
        ...processedTracks,
        ...audioTracks
      ]);
      
      console.log('Created combined stream with', processedTracks.length, 'video tracks and', audioTracks.length, 'audio tracks');

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 150000,  // 150kbps
        audioBitsPerSecond: 24000    // 24kbps
      });
      
      console.log('MediaRecorder created with mimeType:', recorder.mimeType);
      
      recordedChunksRef.current = [];
      
      let lastUploadTime = Date.now();
      const UPLOAD_INTERVAL = 60000;
      
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          
          const totalSize = recordedChunksRef.current.reduce((size, chunk) => size + chunk.size, 0);
          console.log(`Recorded chunk: ${Math.round(event.data.size/1024)}KB, total: ${Math.round(totalSize/1024)}KB`);
          
          const currentTime = Date.now();
          if (totalSize > 5 * 1024 * 1024 && (currentTime - lastUploadTime > UPLOAD_INTERVAL)) {
            console.log('Uploading intermediate recording...');
            
            const chunksToUpload = [...recordedChunksRef.current];
            
            lastUploadTime = currentTime;

            uploadChunks(chunksToUpload, false);
          }
        }
      };
      
      recorder.start(5000);
      console.log('Recording started successfully');
      
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      setUploadStatus('recording_failed');
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || !isRecording) {
      console.warn(`${role}: No active recorder to stop`);
      return;
    }
    
    try {
      console.log(`${role}: Stopping recording...`);
      
      recorder.stop();
      setIsRecording(false);
      setUploadStatus('preparing_final');
      
      setTimeout(() => {
        const finalChunks = [...recordedChunksRef.current];
        const chunkCount = finalChunks.length;
        const totalSize = finalChunks.reduce((size, chunk) => size + chunk.size, 0);
        
        console.log(`${role}: Preparing final upload with ${chunkCount} chunks, total size: ${Math.round(totalSize/1024)}KB`);
        
        if (chunkCount === 0 || totalSize < 1000) {
          console.error(`${role}: No valid recording data collected`);
          setUploadStatus('recording_failed');
          return;
        }
        
        recordedChunksRef.current = [];
        
        uploadChunks(finalChunks, true);
      }, 1000);
      
    } catch (error) {
      console.error(`${role}: Error stopping recording:`, error);
      setUploadStatus('recording_failed');
    }
  };

  useEffect(() => {
    console.log('VideoChat: Upload status changed to:', uploadStatus);
   
    if (onUploadStatusChange) {
      if (uploadStatus === 'processing_recordings') {
        onUploadStatusChange('loading_videos');
      } else {
        onUploadStatusChange(uploadStatus);
      }
    }
  }, [uploadStatus, onUploadStatusChange]);

  useEffect(() => {
    if (!isInterviewStarted && 
        (uploadStatus === 'upload_complete' || 
         uploadStatus === 'complete' || 
         uploadStatus === '')) {
      
      if (!recordings.local && !recordings.remote) {
        console.log('Upload complete but recordings not loaded, fetching recordings...');
        setUploadStatus('processing_recordings');
        
        const timer = setTimeout(() => {
          fetchRecordings(0);
        }, 5000); 
        
        return () => clearTimeout(timer);
      }
    }
  }, [isInterviewStarted, uploadStatus, recordings]);

  const getStatusMessage = (status) => {
    if (!status || status === '') return 'Ready to play';
    
    if (status === 'loading_videos') return 'Loading recordings...';
    if (status === 'pending') return 'Preparing to upload...';
    if (status === 'uploading') return 'Uploading recordings...';
    if (status === 'uploading_final') return 'Finalizing upload...';
    if (status === 'preparing_final') return 'Preparing final recording...';
    if (status === 'processing_recordings') return 'Processing recordings... Please wait';
    if (status === 'complete') return 'Upload complete';
    if (status === 'upload_complete') return 'Upload complete';
    
    if (status.startsWith('retrying_upload_')) {
      const attempt = status.replace('retrying_upload_', '');
      return `Retrying upload (attempt ${attempt})...`;
    }
    
    if (status.includes('failed_to_load')) {
      if (status.includes('corrupted')) {
        return 'Error: Recordings are corrupted';
      } else if (status.includes('No recordings')) {
        return 'Error: No recordings found. Please try refreshing the page.';
      } else {
        return 'Error loading recordings. Please try refreshing the page.';
      }
    }
    
    if (status === 'upload_failed') return 'Upload failed. Please try again.';
    if (status === 'recording_failed') return 'Recording failed. Please try again.';
    
    return status;
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex w-full relative">
        {!isInterviewStarted && connectionStatus !== 'connected' && (
          <div className="absolute top-0 right-0 px-2 py-1 text-xs rounded-bl-md z-10 bg-yellow-500 text-white">
            {connectionStatus === 'connecting' ? 'Connecting...' :
             connectionStatus === 'reconnecting' ? 'Reconnecting...' :
             connectionStatus === 'error' ? 'Connection Error' :
             connectionStatus === 'waiting' ? 'Waiting for participant...' :
             connectionStatus === 'establishing' ? 'Establishing connection...' :
             'Connection issue'}
          </div>
        )}
        
        <div className="flex gap-5 items-center">
          <div className="flex justify-center">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className={`h-[100px] w-[100px] bg-gray-200 rounded-lg object-cover ${
                isLocalSpeaking ? 'ring-2 ring-green-500' : ''
              }`}
            />
          </div>
          <div className="flex justify-center">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`h-[100px] w-[100px] bg-gray-200 rounded-lg object-cover ${
                isRemoteSpeaking ? 'ring-2 ring-green-500' : ''
              }`}
            />
          </div>
        </div>

        {!isInterviewStarted && recordings.local && (
          <div className="flex items-center mx-4 gap-4">
            <button
              onClick={handleMuteToggle}
              className={`flex items-center gap-2 px-3 py-1 rounded-md transition-colors bg-gray-100 hover:bg-gray-200 text-gray-700`}
            >
              {isRecordingsMuted ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3l18 18M10.68 5.01A4 4 0 0 1 19 8v5.35"/>
                    <path d="M19 12v.01"/>
                    <path d="M12 19c-2.8 0-5-2.2-5-5v-3.35l1.64-1.65"/>
                  </svg>
                  <span className="text-sm">Unmute Recordings</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19c-2.8 0-5-2.2-5-5V8c0-2.2 2.2-4 5-4s5 1.8 5 4v6c0 2.8-2.2 5-5 5z"/>
                    <path d="M12 19v3"/>
                    <path d="M8 22h8"/>
                  </svg>
                  <span className="text-sm">Mute Recordings</span>
                </>
              )}
            </button>
          </div>
        )}


        {!isInterviewStarted && (recordings.local || recordings.remote) && (
          <div className="flex gap-5 ml-auto">
            {/* Local video container */}
            <div className="flex justify-center relative">
              {recordings.local ? (
                videoReady.local ? (
                  <video
                    ref={localRecordingRef}
                    playsInline
                    preload="metadata"
                    className="h-[100px] w-[100px] bg-gray-200 rounded-lg object-cover"
                    src={recordings.local.url}
                  />
                ) : (
                  <div className="h-[100px] w-[100px] bg-gray-200 rounded-lg flex items-center justify-center">
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                      <span className="text-xs text-gray-500">Loading...</span>
                    </div>
                  </div>
                )
              ) : (
                <div className="h-[100px] w-[100px] bg-gray-200 rounded-lg flex items-center justify-center">
                  <span className="text-sm text-gray-500">No Recording</span>
                </div>
              )}
              
              {/* Hidden video for preloading */}
              {recordings.local && !videoReady.local && (
                <video
                  style={{ display: 'none' }}
                  preload="metadata"
                  src={recordings.local.url}
                  onLoadedData={() => setVideoReady(prev => ({ ...prev, local: true }))}
                  onError={(e) => {
                    console.log("Error preloading local video, will retry");
                    setTimeout(() => {
                      const video = e.target;
                      const timestamp = Date.now();
                      const originalSrc = video.src.split('?')[0];
                      video.src = `${originalSrc}?t=${timestamp}`;
                    }, 2000);
                  }}
                />
              )}
            </div>
            
            {/* Remote video container */}
            <div className="flex justify-center relative">
              {recordings.remote ? (
                videoReady.remote ? (
                  <video
                    ref={remoteRecordingRef}
                    playsInline
                    preload="metadata"
                    className="h-[100px] w-[100px] bg-gray-200 rounded-lg object-cover"
                    src={recordings.remote.url}
                  />
                ) : (
                  <div className="h-[100px] w-[100px] bg-gray-200 rounded-lg flex items-center justify-center">
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                      <span className="text-xs text-gray-500">Loading...</span>
                    </div>
                  </div>
                )
              ) : (
                <div className="h-[100px] w-[100px] bg-gray-200 rounded-lg flex items-center justify-center">
                  <span className="text-sm text-gray-500">No Recording</span>
                </div>
              )}
              
              {/* Hidden video for preloading */}
              {recordings.remote && !videoReady.remote && (
                <video
                  style={{ display: 'none' }}
                  preload="metadata"
                  src={recordings.remote.url}
                  onLoadedData={() => setVideoReady(prev => ({ ...prev, remote: true }))}
                  onError={(e) => {
                    console.log("Error preloading remote video, will retry");
                    setTimeout(() => {
                      const video = e.target;
                      const timestamp = Date.now();
                      const originalSrc = video.src.split('?')[0];
                      video.src = `${originalSrc}?t=${timestamp}`;
                    }, 2000);
                  }}
                />
              )}
            </div>
          </div>
        )}
        
        {!isInterviewStarted && !recordings.local && uploadStatus === 'loading_videos' && duration > 0 && (
          <div className="flex gap-5 ml-auto">
            <div className="h-[100px] w-[100px] bg-gray-200 rounded-lg flex items-center justify-center">
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                <span className="text-xs text-gray-500">Loading...</span>
              </div>
            </div>
            <div className="h-[100px] w-[100px] bg-gray-200 rounded-lg flex items-center justify-center">
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                <span className="text-xs text-gray-500">Loading...</span>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-4">
        {isRecording && (
          <div className="text-sm text-red-500 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
            Recording
          </div>
        )}
        {uploadStatus && (isRecording || duration > 0 || uploadStatus.includes('fail') || uploadStatus.includes('complete')) && (
          <div className={`text-sm flex items-center gap-2 ${
            uploadStatus === 'upload_complete' 
              ? 'text-green-500' 
              : uploadStatus === 'upload_failed' || uploadStatus.includes('failed')
              ? 'text-red-500'
              : 'text-blue-500'
          }`}>
            {(uploadStatus.startsWith('uploading') || uploadStatus === 'loading_videos') && (
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
            )}
            {getStatusMessage(uploadStatus)}
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoChat;
