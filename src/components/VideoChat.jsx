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
  duration 
}) => {
  const [peer, setPeer] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isLocalStreamReady, setIsLocalStreamReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [recordings, setRecordings] = useState({ local: null, remote: null });
  const [isRecordingsMuted, setIsRecordingsMuted] = useState(true);
  const [isAutoMuteEnabled, setIsAutoMuteEnabled] = useState(true);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localRecordingRef = useRef(null);
  const remoteRecordingRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);

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

      playVideo(localRecordingRef.current);
      playVideo(remoteRecordingRef.current);
    }
  }, [isPlaying, isInterviewStarted, currentTime, duration]);

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

      const cleanupLocal = initVideo(localRecordingRef.current);
      const cleanupRemote = initVideo(remoteRecordingRef.current);

      return () => {
        cleanupLocal?.();
        cleanupRemote?.();
      };
    }
  }, [isInterviewStarted]);

  const setupAudioAnalysis = (stream, isLocal = true) => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const checkAudioLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      if (isLocal) {
        setIsLocalSpeaking(average > 30);
      } else {
        setIsRemoteSpeaking(average > 30);
      }
      animationFrameRef.current = requestAnimationFrame(checkAudioLevel);
    };
    checkAudioLevel();

    return { audioContext, analyser };
  };

  useEffect(() => {
    if (isAutoMuteEnabled && !isInterviewStarted && isPlaying) {
      const shouldMute = isLocalSpeaking || isRemoteSpeaking;
      setIsRecordingsMuted(shouldMute);
      
      if (localRecordingRef.current) {
        localRecordingRef.current.muted = shouldMute;
      }
      if (remoteRecordingRef.current) {
        remoteRecordingRef.current.muted = shouldMute;
      }
    }
  }, [isLocalSpeaking, isRemoteSpeaking, isAutoMuteEnabled, isInterviewStarted, isPlaying]);

  useEffect(() => {
    const cleanupContexts = [];

    if (localVideoRef.current?.srcObject) {
      const { audioContext } = setupAudioAnalysis(localVideoRef.current.srcObject, true);
      cleanupContexts.push(audioContext);
    }

    if (remoteVideoRef.current?.srcObject) {
      const { audioContext } = setupAudioAnalysis(remoteVideoRef.current.srcObject, false);
      cleanupContexts.push(audioContext);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      cleanupContexts.forEach(context => {
        if (context) {
          context.close();
        }
      });
    };
  }, [localVideoRef.current?.srcObject, remoteVideoRef.current?.srcObject]);

  const fetchRecordings = async () => {
    try {
      setUploadStatus('Loading recordings...');
      console.log(`Fetching recordings for room: ${roomId}`);
      
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
        
        setUploadStatus(`Failed to load recordings: ${errorData.error || res.statusText}`);
        return;
      }
      
      let data;
      try {
        data = await res.json();
      } catch (parseError) {
        console.error('Error parsing recordings response:', parseError);
        setUploadStatus('Invalid response format');
        return;
      }
      
      if (!data.recordings || !Array.isArray(data.recordings)) {
        console.error('Unexpected response format:', data);
        setUploadStatus('Invalid recordings data');
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
      
      setRecordings({ 
        local: localRec || null, 
        remote: remoteRec || null 
      });
      
      setUploadStatus('');
    } catch (err) {
      console.error('Error fetching recordings:', err);
      setUploadStatus('Error loading recordings');
    }
  };

  useEffect(() => {
    if (!isInterviewStarted) {
      fetchRecordings();
    } else {
      setRecordings({ local: null, remote: null });
    }
  }, [roomId, isInterviewStarted]);

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

  useEffect(() => {
    const initPeer = async (retryCount = 0) => {
      try {
        if (peer) {
          peer.destroy();
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const peerConfig = process.env.NODE_ENV === 'production' ? {
        host: window.location.hostname,
        path: '/peerService/peer',
        secure: window.location.protocol === 'https:'
      } : {
        host: 'localhost',
        port: 9000,
        path: '/peer'
      };
      
      const newPeer = new Peer(`${roomId}-${role}`, peerConfig);

      newPeer.on('open', async (id) => {
        console.log('Connected to peer server with ID:', id);
        
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
            setIsLocalStreamReady(true);
            onVideoReady(true);
          }

          const otherRole = role === 'interviewer' ? 'interviewee' : 'interviewer';
          try {
            const call = newPeer.call(`${roomId}-${otherRole}`, stream);
            call.on('stream', (remoteVideoStream) => {
              if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = remoteVideoStream;
                setRemoteStream(remoteVideoStream);
                onVideoReady(true);
              }
            });
          } catch (err) {
            console.log(`Waiting for ${otherRole} to join...`);
          }
        } catch (err) {
          console.error('Error accessing media devices:', err);
          onVideoReady(false);
        }
      });

      newPeer.on('error', (err) => {
        console.error('Peer connection error:', err);
        
        if (err.type === 'unavailable-id' && retryCount < 3) {
          console.log(`Retrying peer connection in 2 seconds... (attempt ${retryCount + 1})`);
          setTimeout(() => initPeer(retryCount + 1), 2000);
          return;
        }
        
        onVideoReady(false);
      });

      newPeer.on('call', async (call) => {
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
            setIsLocalStreamReady(true);
            onVideoReady(true);
          }
          
          call.answer(stream);
          call.on('stream', (remoteVideoStream) => {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteVideoStream;
              setRemoteStream(remoteVideoStream);
              onVideoReady(true);
            }
          });
        } catch (err) {
          console.error('Error answering call:', err);
          onVideoReady(false);
        }
      });

      setPeer(newPeer);
    } catch (error) {
      console.error('Error in initPeer:', error);
      if (retryCount < 3) {
        console.log(`Retrying peer connection in 2 seconds... (attempt ${retryCount + 1})`);
        setTimeout(() => initPeer(retryCount + 1), 2000);
      }
    }
  };

  initPeer();

    return () => {
      const cleanup = async () => {
        if (localVideoRef.current?.srcObject) {
          localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
          localVideoRef.current.srcObject = null;
        }
        if (remoteVideoRef.current?.srcObject) {
          remoteVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
          remoteVideoRef.current.srcObject = null;
        }
        
        if (peer) {
          peer.destroy();
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        setIsLocalStreamReady(false);
        setRemoteStream(null);
        onVideoReady(false);
      };
      
      cleanup();
    };
  }, [roomId, role]);

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
    if (isInterviewStarted && !isRecording && localVideoRef.current?.srcObject && remoteVideoRef.current?.srcObject) {
      startRecording();
    } else if (!isInterviewStarted && isRecording) {
      stopRecording();
    }
  }, [isInterviewStarted, isRecording]);

  const uploadChunks = async (chunks, isFinal = false, retryCount = 0) => {
    if (!chunks || chunks.length === 0) {
      console.warn('No chunks to upload');
      return;
    }
    
    const blob = new Blob(chunks, { type: 'video/webm' });
    const chunkSizeKB = Math.round(blob.size/1024);
    
    console.log(`Preparing to upload ${isFinal ? 'FINAL' : 'intermediate'} recording: ${chunkSizeKB}KB`);
    
    if (blob.size < 1000) { // 1KB minimum
      console.warn('Blob too small to be a valid recording, skipping upload');
      return;
    }
    
    try {
      setUploadStatus(isFinal ? 'Uploading final recording...' : 'Uploading...');
      
      const formData = new FormData();
      formData.append('file', blob, `recording-${roomId}-${role}-${Date.now()}.webm`);
      formData.append('roomId', roomId);
      formData.append('userId', userId);
      formData.append('role', role);
      formData.append('isFinal', isFinal.toString());
      
      formData.append('partIndex', '0');
      formData.append('totalParts', '1');
      
      const uploadResponse = await fetch('/api/cloudinary/server-upload', {
        method: 'POST',
        body: formData
      });
      
      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json();
        console.error('Server upload error:', errorData);
        throw new Error(`Upload failed: ${errorData.error || 'Unknown error'} - ${errorData.message || ''}`);
      }
      
      const uploadResult = await uploadResponse.json();
      
      if (uploadResult.intermediate) {
        console.log('Server acknowledged intermediate upload');
        setUploadStatus('');
        return;
      }
      
      console.log('Upload successful:', uploadResult.url, `(${Math.round(uploadResult.bytes/1024)}KB)`);
      
      if (isFinal) {
        setUploadStatus('Upload complete');
        socketService.socket.emit('upload:status', {
          roomId,
          role,
          status: 'complete',
          videoUrl: uploadResult.url,
          publicId: uploadResult.publicId,
          displayName: uploadResult.displayName
        });
        fetchRecordings();
      } else {
        setUploadStatus('');
      }
    } catch (error) {
      console.error('Error uploading to server:', error);
      
      if (retryCount < 3) {
        console.log(`Retrying upload (attempt ${retryCount + 1} of 3)...`);
        setUploadStatus(`Retrying upload (${retryCount + 1}/3)...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return uploadChunks(chunks, isFinal, retryCount + 1);
      }
      
      if (isFinal) {
        setUploadStatus('Upload failed - please try again');
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
      
      if (!localStream || !remoteStream) {
        console.error('Video streams not ready for recording');
        return;
      }

      const processedTracks = [];
      
      const localVideoTrack = localStream.getVideoTracks()[0];
      const remoteVideoTrack = remoteStream.getVideoTracks()[0];
      
      if (localVideoTrack) {
        try {
          const canvas = document.createElement('canvas');
          // reduced resolution here

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
          // reduced resolution here
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
      }

      const audioTracks = [
        ...localStream.getAudioTracks(),
        ...remoteStream.getAudioTracks()
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
        // probably try higher bitrates later. 
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
            // as for now, intermediate chunks only goes to the nextjs api endpoint
            // the nextjs server will upload the chunks to cloudinary when interview finished
            // for future updates, upload in chunks is needed
            // check if there's a built in function for this from cloudinary
            console.log('Uploading intermediate recording...');
            
            const chunksToUpload = [...recordedChunksRef.current];
            
            lastUploadTime = currentTime;

            uploadChunks(chunksToUpload, false);
          }
        }
      };
      
      recorder.start(5000);
      console.log('Recording started');
      
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      setUploadStatus('Failed to start recording');
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || !isRecording) {
      console.warn('No active recorder to stop');
      return;
    }
    
    try {
      console.log('Stopping recording...');
      
      recorder.stop();
      setIsRecording(false);
      setUploadStatus('Preparing final recording...');
      
      setTimeout(() => {
        const finalChunks = [...recordedChunksRef.current];
        const chunkCount = finalChunks.length;
        const totalSize = finalChunks.reduce((size, chunk) => size + chunk.size, 0);
        
        console.log(`Preparing final upload with ${chunkCount} chunks, total size: ${Math.round(totalSize/1024)}KB`);
        
        if (chunkCount === 0 || totalSize < 1000) {
          console.error('No valid recording data collected');
          setUploadStatus('Recording failed - no data collected');
          return;
        }
        
        recordedChunksRef.current = [];
        
        uploadChunks(finalChunks, true);
      }, 1000);
      
    } catch (error) {
      console.error('Error stopping recording:', error);
      setUploadStatus('Failed to stop recording properly');
    }
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex w-full">
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
              onClick={() => setIsAutoMuteEnabled(!isAutoMuteEnabled)}
              className={`flex items-center gap-2 px-3 py-1 rounded-md transition-colors ${
                isAutoMuteEnabled 
                  ? 'bg-green-100 hover:bg-green-200 text-green-700' 
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 6H3"/>
                <path d="M15 12H3"/>
                <path d="M17 18H3"/>
                <path d="M17 6l4 6-4 6"/>
              </svg>
              <span className="text-sm">Auto-Mute: {isAutoMuteEnabled ? 'On' : 'Off'}</span>
            </button>
            <button
              onClick={() => {
                setIsRecordingsMuted(!isRecordingsMuted);
                if (remoteVideoRef.current) {
                  remoteVideoRef.current.muted = !isRecordingsMuted;
                }
              }}
              className="flex items-center gap-2 px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 transition-colors"
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

        {!isInterviewStarted && recordings.local && (
          <div className="flex gap-5 ml-auto">
            <div className="flex justify-center">
              <video
                ref={localRecordingRef}
                playsInline
                preload="metadata"
                className="h-[100px] w-[100px] bg-gray-200 rounded-lg object-cover"
                src={recordings.local.url}
                onError={() => console.error('Error loading local recording')}
              />
            </div>
            <div className="flex justify-center">
              {recordings.remote ? (
                <video
                  ref={remoteRecordingRef}
                  playsInline
                  preload="metadata"
                  className="h-[100px] w-[100px] bg-gray-200 rounded-lg object-cover"
                  src={recordings.remote.url}
                  onError={() => console.error('Error loading remote recording')}
                />
              ) : (
                <div className="h-[100px] w-[100px] bg-gray-200 rounded-lg flex items-center justify-center">
                  <span className="text-sm text-gray-500">No Recording</span>
                </div>
              )}
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
        {uploadStatus && (
          <div className={`text-sm flex items-center gap-2 ${
            uploadStatus === 'Upload complete' 
              ? 'text-green-500' 
              : uploadStatus === 'Upload failed'
              ? 'text-red-500'
              : 'text-blue-500'
          }`}>
            {uploadStatus === 'Uploading...' && (
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
            )}
            {uploadStatus}
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoChat;
