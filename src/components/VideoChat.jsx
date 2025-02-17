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
      const res = await fetch(`/api/recordings/rooms/${roomId}/list`);
      if (res.ok) {
        const data = await res.json();
        const localRec = data.recordings.find(r => r.role === role);
        const remoteRec = data.recordings.find(r => r.role !== role);
        setRecordings({ local: localRec || null, remote: remoteRec || null });
      }
    } catch (err) {
      console.log('Could not load recordings:', err);
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
    const initPeer = async () => {
      if (peer) {
        peer.destroy();
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
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 20 }
            }, 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 44100
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
        onVideoReady(false);
      });

      newPeer.on('call', async (call) => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: {
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 20 }
            }, 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 44100
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
    };

    initPeer();

    return () => {
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
      }
      
      setIsLocalStreamReady(false);
      setRemoteStream(null);
      onVideoReady(false);
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

  const uploadChunks = async (chunks, isFinal = false) => {
    if (chunks.length === 0) return;
    
    const blob = new Blob(chunks, {
      type: 'video/webm'
    });
    
    const formData = new FormData();
    formData.append('recording', blob, `interview-${roomId}-${new Date().toISOString()}.webm`);
    formData.append('userId', userId);
    formData.append('role', role);
    formData.append('isFinal', isFinal.toString());

    try {
      const response = await fetch(`/api/recordings/rooms/${roomId}/upload`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error('Failed to upload recording chunk');
      }
      
      if (isFinal) {
        setUploadStatus('Upload complete');
        socketService.socket.emit('upload:status', {
          roomId,
          role,
          status: 'complete'
        });
        fetchRecordings();
      }
    } catch (error) {
      console.error('Error uploading recording chunk:', error);
      if (isFinal) {
        setUploadStatus('Upload failed');
        socketService.socket.emit('upload:status', {
          roomId,
          role,
          status: 'failed'
        });
      }
    }
  };

  const startRecording = () => {
    try {
      const localStream = localVideoRef.current.srcObject;
      const remoteStream = remoteVideoRef.current.srcObject;
      
      if (!localStream || !remoteStream) {
        console.error('Streams not ready for recording');
        return;
      }

      const tracks = [...localStream.getTracks(), ...remoteStream.getTracks()];
      const combinedStream = new MediaStream(tracks);

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 600000,
        audioBitsPerSecond: 128000
      });

      const uploadInterval = setInterval(() => {
        if (recordedChunksRef.current.length > 0) {
          const chunksToUpload = [...recordedChunksRef.current];
          recordedChunksRef.current = [];
          uploadChunks(chunksToUpload);
        }
      }, 30000);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      mediaRecorderRef.current.uploadInterval = uploadInterval;
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && isRecording) {
      if (recorder.uploadInterval) {
        clearInterval(recorder.uploadInterval);
      }
      
      recorder.stop();
      setIsRecording(false);
      
      setUploadStatus('Uploading final chunk...');
      setTimeout(() => {
        if (recordedChunksRef.current.length > 0) {
          const finalChunks = [...recordedChunksRef.current];
          recordedChunksRef.current = [];
          uploadChunks(finalChunks, true);
        } else {
          setUploadStatus('Upload complete');
          fetchRecordings();
        }
      }, 100);
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
                preload="auto"
                className="h-[100px] w-[100px] bg-gray-200 rounded-lg object-cover"
                src={`/api/recordings/stream/${recordings.local.id}`}
              />
            </div>
            <div className="flex justify-center">
              {recordings.remote ? (
                <video
                  ref={remoteRecordingRef}
                  playsInline
                  preload="auto"
                  className="h-[100px] w-[100px] bg-gray-200 rounded-lg object-cover"
                  src={`/api/recordings/stream/${recordings.remote.id}`}
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
