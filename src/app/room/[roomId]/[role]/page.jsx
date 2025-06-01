'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { socketService } from '@/lib/socketService';
import CodeEditor from '@/components/CodeEditor';
import VideoChat from '@/components/VideoChat';
import Timeline from '@/components/Timeline';
import CollaborationService from '@/lib/collaborationService';
import { Button } from '@/components/ui/button';
import { useSession, signIn } from "next-auth/react";
import { getArchivedRoom } from '@/lib/apiAgent';
import InterviewerPanel from '@/components/InterviewPanel';
import IntervieweePanel from '@/components/IntervieweePanel';
import QuestionEditor from '@/components/QuestionEditor';

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
  const [isSeeking, setIsSeeking] = useState(false);
  const [timelineController, setTimelineController] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('pending');
  const [uploadStatuses, setUploadStatuses] = useState({
    interviewer: false,
    interviewee: false
  });

  const [archivedNotes, setArchivedNotes] = useState('');
  const [archivedNoteLines, setArchivedNoteLines] = useState([]);
  const [archivedQuestionContent, setArchivedQuestionContent] = useState('');
  const [intervieweeNotes, setIntervieweeNotes] = useState('');
  const [intervieweeNoteLines, setIntervieweeNoteLines] = useState([]);
  const [activeTab, setActiveTab] = useState('question');
  const [isCollaborationReady, setIsCollaborationReady] = useState(false);
  const codeEditorRef = useRef(null);

  const [selectedRange, setSelectedRange] = useState(null);
  const [highlightRange, setHighlightRange] = useState(null);

  
  useEffect(() => {
    console.log("Operations state in room:", operations);
  }, [operations]);

  useEffect(() => {
    console.log("Selected range:", selectedRange);
  }, [selectedRange]);
  
  const startTimeRef = useRef(null);
  const endTimeRef = useRef(null);
  const playIntervalRef = useRef(null);
  const collaborationRef = useRef(null);
  const lastUpdateRef = useRef(null);
  const notepadRef = useRef(null);
  const intervieweeNotepadRef = useRef(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      const callbackUrl = `/room/${roomId}/${role}`;
      signIn('auth0', { callbackUrl });
      return;
    }

    if (status === "authenticated" && session?.user?.email) {
      const setupRoom = async () => {
        try {
          if (collaborationRef.current) {
            collaborationRef.current.destroy();
            collaborationRef.current = null;
          }
          if (socketService.socket?.connected) {
            socketService.disconnect();
          }
          if (playIntervalRef.current) {
            clearInterval(playIntervalRef.current);
            playIntervalRef.current = null;
          }

          await socketService.connect(process.env.NEXT_PUBLIC_SOCKET_URL);

          socketService.onError((error) => {
            console.log('Socket error:', error);
            
            if (error.type === 'JOIN_ERROR') {
              if (error.message.includes('role is taken')) {
                setError(`This role is already taken. Please use a different link or contact the room creator.`);
              } else if (error.message.includes('Already joined in another role')) {
                setError(`You are already in this room with a different role. You cannot join with multiple roles.`);
              } else {
                setError(`Cannot join room: ${error.message}`);
              }
            } else if (error.type === 'ROOM_ERROR') {
              if (error.message.includes('Room not found')) {
                setError('This room does not exist. Please check the URL or contact the room creator.');
              } else {
                setError(`Room error: ${error.message}`);
              }
            } else {
              setError(error.message || 'An unknown error occurred');
            }
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
            
            if (collaborationRef.current?.doc) {
              const transitionTimestamp = collaborationRef.current.yState.get('transitionTimestamp');
              const currentTime = Date.now();
              
              collaborationRef.current.doc.transact(() => {
                if (role === 'interviewee') {
                  collaborationRef.current.yState.set('operationApplier', null);
                  collaborationRef.current.yState.set('operationsInitialized', false);
                  collaborationRef.current.yState.set('operationsInitializer', null);
                } else if (role === 'interviewer') {
                  if (!transitionTimestamp) {
                    collaborationRef.current.yState.set('transitionTimestamp', currentTime);
                    collaborationRef.current.yState.set('operationApplier', session.user.email);
                    collaborationRef.current.yState.set('operationsInitialized', true);
                    collaborationRef.current.yState.set('operationsInitializer', session.user.email);
                  }
                }
              });
            }
            
            setRoomState('ARCHIVED');
          });

          socketService.socket.on('upload:status', ({ role, status }) => {
            setUploadStatuses(prev => ({
              ...prev,
              [role]: status === 'complete'
            }));
          });

          socketService.socket.on('video:ready', ({ role, ready }) => {
            setParticipants(prev => ({
              ...prev,
              [role]: { ...prev[role], videoReady: ready }
            }));
          });

          try {
            const room = await getArchivedRoom(roomId);
            console.log('Found archived room:', room);
            
            setRoomState('ARCHIVED');
            setUploadStatuses(room.uploadStatus || {
              interviewer: false,
              interviewee: false
            });
            setUploadStatus(
              room.uploadStatus?.interviewer && room.uploadStatus?.interviewee 
                ? 'complete' 
                : 'incomplete'
            );
            setDuration(room.duration);
            startTimeRef.current = room.startedAt;
            endTimeRef.current = room.endTime;
            
            if (collaborationRef.current?.doc) {
              collaborationRef.current.doc.transact(() => {
                collaborationRef.current.yState.set('operationApplier', null);
                collaborationRef.current.yState.set('operationsInitialized', false);
                collaborationRef.current.yState.set('operationsInitializer', null);
              });
            }
            
            const archivedOperations = room.codeOperations || [];
            console.log("Archived operations from server:", archivedOperations.length);
            setOperations(archivedOperations);
            
            if (role === 'interviewer') {
              setArchivedNotes(room.noteContent || '');
              setArchivedNoteLines(room.noteLines || []);
            } else if (role === 'interviewee') {
              setIntervieweeNotes(room.intervieweeNoteContent || '');
              setIntervieweeNoteLines(room.intervieweeNoteLines || []);
            }
            
            setArchivedQuestionContent(room.questionContent || '');
          } catch (err) {
            if (err?.response?.status !== 404) {
              console.error('Error fetching room:', err);
            }
          }

          if (!collaborationRef.current) {
            collaborationRef.current = new CollaborationService(roomId, session.user.email, role);

            collaborationRef.current.onHighlightChange(({ range, timestamp, fromUser, action }) => {
              console.log(`Received highlight from ${fromUser}:`, { action, range, timestamp });
              
              if (action === 'highlight' && range) {
                setHighlightRange(range);
                if (codeEditorRef.current && codeEditorRef.current.highlightRange) {
                  codeEditorRef.current.highlightRange(range);
                }
                
                if (timestamp && timestamp !== null) {
                  const newTime = timestamp - startTimeRef.current;
                  setCurrentTime(newTime);
                  
                  if (collaborationRef.current?.doc) {
                    collaborationRef.current.doc.transact(() => {
                      collaborationRef.current.yTimeline.set('currentTime', newTime);
                    });
                  }
                }
              } else if (action === 'clear') {
                setHighlightRange(null);
                if (codeEditorRef.current && codeEditorRef.current.clearHighlight) {
                  codeEditorRef.current.clearHighlight();
                }
              }
            });
            
            collaborationRef.current.onTimelineUpdate(({ currentTime, controlledBy, isPlaying, isSeeking, seekingUser }) => {
              if (controlledBy !== session.user.email) {
                setCurrentTime(currentTime);
              }
              setTimelineController({
                userId: controlledBy,
                isSeeking,
                seekingUser
              });
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
            
            collaborationRef.current.provider.on('status', ({ status }) => {
              console.log('Collaboration status:', status);
              setIsCollaborationReady(status === 'connected');
              
              if (status === 'connected' && roomState === 'ARCHIVED' && operations.length > 0) {
                const states = collaborationRef.current.awareness.getStates();
                const clientCount = states.size;
                
                const isInitialized = collaborationRef.current.yState.get('operationsInitialized');
                const initializer = collaborationRef.current.yState.get('operationsInitializer');
                
                if (!isInitialized && !initializer) {
                  if (clientCount <= 1) {
                    console.log('First client connected, becoming operations initializer');
                    collaborationRef.current.yState.set('operationsInitialized', true);
                    collaborationRef.current.yState.set('operationsInitializer', session.user.email);
                  } else {
                    setTimeout(() => {
                      const updatedInitializer = collaborationRef.current.yState.get('operationsInitializer');
                      if (!updatedInitializer) {
                        console.log('No initializer set yet, claiming the role');
                        collaborationRef.current.yState.set('operationsInitialized', true);
                        collaborationRef.current.yState.set('operationsInitializer', session.user.email);
                      }
                    }, 1000);
                  }
                }
              }

              if (status === 'connected' && collaborationRef.current) {
                const currentHighlight = collaborationRef.current.getCurrentHighlight();
                if (currentHighlight.range && currentHighlight.highlightedBy !== session?.user?.email) {
                  console.log('Loading existing highlight from:', currentHighlight.highlightedBy);
                  setHighlightRange(currentHighlight.range);
                  if (codeEditorRef.current && codeEditorRef.current.highlightRange) {
                    codeEditorRef.current.highlightRange(currentHighlight.range);
                  }
                }
              }
            });
          }

        } catch (err) {
          setError(err.message);
        }
      };

      setupRoom();

      return () => {
        const cleanup = async () => {
          if (playIntervalRef.current) {
            clearInterval(playIntervalRef.current);
            playIntervalRef.current = null;
          }
          
          if (collaborationRef.current?.awareness) {
            try {
              const currentState = collaborationRef.current.awareness.getLocalState();
              if (currentState) {
                collaborationRef.current.awareness.setLocalState({
                  ...currentState,
                  cursors: null,
                  mousePointer: null
                });
              }
            } catch (err) {
              console.error('Error cleaning up awareness state:', err);
            }
          }
          
          if (collaborationRef.current) {
            try {
              collaborationRef.current.destroy();
            } catch (err) {
              console.error('Error destroying collaboration service:', err);
            }
            collaborationRef.current = null;
          }
          
          try {
            socketService.disconnect();
          } catch (err) {
            console.error('Error disconnecting socket:', err);
          }
          
          setRoomState('CREATED');
          setRemotePointers({});
          setParticipants({
            interviewer: { present: false, videoReady: false },
            interviewee: { present: false, videoReady: false }
          });
          setOperations([]);
          setCurrentTime(0);
          setDuration(0);
          setIsPlaying(false);
          setTimelineController(null);
          setUploadStatus('pending');
          setUploadStatuses({
            interviewer: false,
            interviewee: false
          });
          setArchivedNotes('');
          setArchivedNoteLines([]);
          setArchivedQuestionContent('');
          setIntervieweeNotes('');
          setIntervieweeNoteLines([]);
          setIsCollaborationReady(false);
        };
        
        cleanup();
      };
    }
  }, [status, roomId, session?.user?.email, role]);

  useEffect(() => {
    if (uploadStatuses.interviewer && uploadStatuses.interviewee) {
      setUploadStatus('complete');
    } else if (roomState === 'ARCHIVED') {
      setUploadStatus('uploading');
    } else {
      setUploadStatus('pending');
    }
  }, [uploadStatuses, roomState]);

  const handleLiveUpdate = (text, lines) => {
    console.log("LIVE UPDATE!!")
    setArchivedNotes(text);
    setArchivedNoteLines(lines);
    
  }

  const handleIntervieweeLiveUpdate = (text, lines) => {
    console.log("INTERVIEWEE LIVE UPDATE!!")
    setIntervieweeNotes(text);
    setIntervieweeNoteLines(lines);
    
  }

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
      
      if (collaborationRef.current?.doc) {
        collaborationRef.current.doc.transact(() => {
          collaborationRef.current.yState.set('operationApplier', session.user.email);
          collaborationRef.current.yState.set('operationsInitialized', true);
          collaborationRef.current.yState.set('operationsInitializer', session.user.email);
        });
      }
      
      const questionContent = collaborationRef.current?.doc.getText('questionContent').toString() || '';
      
      setUploadStatus('uploading');
      socketService.socket.emit('room:end', { 
        roomId, 
        userId: session.user.email,
        operations: operations,
        duration: actualDuration,
        endTime,
        questionContent
      });

      collaborationRef.current?.releaseTimelineControl();
    }
  };

  const handleOperationsUpdate = (newOperations, newDuration) => {
    const isArchived = roomState === 'ARCHIVED';
    
    if (isArchived || !isPlaying) {
      const ops = isArchived ? 
        newOperations : 
        newOperations.filter(op => !op.source || op.source === session?.user?.email);
      
      console.log(`Updating operations (${roomState}):`, ops.length);
      setOperations(ops);
      setDuration(newDuration);
      
      if (isArchived) {
        const initializer = collaborationRef.current?.yState.get('operationsInitializer');
        const isInitialized = collaborationRef.current?.yState.get('operationsInitialized');
        
        if (!isInitialized && !initializer && operations.length === 0) {
          console.log('Setting self as operations initializer');
          collaborationRef.current.doc.transact(() => {
            collaborationRef.current.yState.set('operationsInitialized', true);
            collaborationRef.current.yState.set('operationsInitializer', session?.user?.email);
          });
        }
        
        if (!initializer || initializer === session?.user?.email) {
          console.log('Saving operations to server as initializer');
          socketService.socket.emit('room:update_operations', { 
            roomId, 
            operations: ops
          });
        }
      }
    } else {
      setOperations([]);
    }
  };

  useEffect(() => {
    const playbackController = collaborationRef.current?.yTimeline.get('playbackController');
    const isCurrentController = playbackController === session?.user?.email;

    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }

    if (isPlaying && isCurrentController) {
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
            
            try {
              if (collaborationRef.current?.doc) {
                collaborationRef.current.doc.transact(() => {
                  collaborationRef.current.yTimeline.set('isPlaying', false);
                  collaborationRef.current.yTimeline.set('playbackController', null);
                  collaborationRef.current.yTimeline.set('currentTime', duration);
                  collaborationRef.current.yTimeline.set('controlledBy', null);
                  collaborationRef.current.yState.set('operationApplier', null);
                });
              }
            } catch (error) {
              console.error("Error updating shared state at end of playback:", error);
            }
            
            return duration;
          }
          
          if (collaborationRef.current?.doc) {
            collaborationRef.current.doc.transact(() => {
              collaborationRef.current.yTimeline.set('currentTime', newTime);
            });
          }
          
          return newTime;
        });
      }, INTERVAL_MS);
    }

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [isPlaying, duration, session?.user?.email]);

  const handleCodeRangeClick = (range, timestamp = null) => {
    if (roomState !== 'ARCHIVED' || !range) return;
    
    try {
      if (isPlaying) {
        setIsPlaying(false);
        if (playIntervalRef.current) {
          clearInterval(playIntervalRef.current);
          playIntervalRef.current = null;
        }
        
        if (collaborationRef.current?.doc) {
          collaborationRef.current.doc.transact(() => {
            collaborationRef.current.yTimeline.set('isPlaying', false);
            collaborationRef.current.yTimeline.set('playbackController', null);
            collaborationRef.current.yState.set('operationApplier', null);
          });
        }
      }
      
      const cleanRange = {
        from: range.from,
        to: range.to || range.from + (range.text?.length || 1),
        text: range.text || "Selected code"
      };
      
      if (timestamp && timestamp !== null) {
        const newTime = timestamp - startTimeRef.current;
        setCurrentTime(newTime);
        
        if (collaborationRef.current?.doc) {
          collaborationRef.current.doc.transact(() => {
            collaborationRef.current.yTimeline.set('currentTime', newTime);
          });
        }
        
        setTimeout(() => {
          setHighlightRange(cleanRange);
          if (codeEditorRef.current && codeEditorRef.current.highlightRange) {
            codeEditorRef.current.highlightRange(cleanRange);
          }
          
          if (collaborationRef.current) {
            collaborationRef.current.shareCodeHighlight(cleanRange, timestamp);
          }
        }, 150);
      } else {
        setHighlightRange(cleanRange);
        if (codeEditorRef.current && codeEditorRef.current.highlightRange) {
          codeEditorRef.current.highlightRange(cleanRange);
        }
        
        if (collaborationRef.current) {
          collaborationRef.current.shareCodeHighlight(cleanRange, null);
        }
      }
    } catch (error) {
      console.error("Error in handleCodeRangeClick:", error);
    }
  };

  const handleTimestampClick = (timestamp) => {
    if (roomState !== 'ARCHIVED') {
      return;
    }
    
    if (isPlaying) {
      setIsPlaying(false);
      
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
      
      try {
        if (collaborationRef.current?.doc) {
          collaborationRef.current.doc.transact(() => {
            collaborationRef.current.yTimeline.set('isPlaying', false);
            collaborationRef.current.yTimeline.set('playbackController', null);
            collaborationRef.current.yState.set('operationApplier', null);
          });
        }
      } catch (error) {
        console.error("Error updating shared state during timestamp click:", error);
      }
    }
    
    setHighlightRange(null);
    if (codeEditorRef.current && codeEditorRef.current.clearHighlight) {
      codeEditorRef.current.clearHighlight();
    }
    
    if (collaborationRef.current) {
      collaborationRef.current.clearCodeHighlight();
    }
    
    const seekTime = timestamp - startTimeRef.current;
    setCurrentTime(seekTime);
    
    try {
      if (collaborationRef.current?.doc) {
        collaborationRef.current.doc.transact(() => {
          collaborationRef.current.yTimeline.set('controlledBy', null);
          collaborationRef.current.yTimeline.set('currentTime', seekTime);
        });
      }
    } catch (error) {
      console.error("Error updating shared state during timestamp click:", error);
    }
  };

  const togglePlayback = () => {
    if (!isPlaying) {
      setHighlightRange(null);
      if (codeEditorRef.current && codeEditorRef.current.clearHighlight) {
        codeEditorRef.current.clearHighlight();
      }
      
      if (collaborationRef.current) {
        collaborationRef.current.clearCodeHighlight();
      }
    }
    
    if (isPlaying) {
      setIsPlaying(false);
      
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
      
      try {
        if (collaborationRef.current?.doc) {
          collaborationRef.current.doc.transact(() => {
            collaborationRef.current.yTimeline.set('isPlaying', false);
            collaborationRef.current.yTimeline.set('playbackController', null);
            collaborationRef.current.yTimeline.set('controlledBy', null);
            collaborationRef.current.yState.set('operationApplier', null);
          });
        }
      } catch (error) {
        console.error("Error updating shared state:", error);
      }
      
      return;
    }
    
    setIsPlaying(true);
    
    if (Math.abs(currentTime - duration) < 50) {
      setCurrentTime(0);
    }
    
    try {
      if (collaborationRef.current?.doc) {
        collaborationRef.current.doc.transact(() => {
          collaborationRef.current.yState.set('operationApplier', session?.user?.email);
          collaborationRef.current.yTimeline.set('isPlaying', true);
          collaborationRef.current.yTimeline.set('playbackController', session?.user?.email);
          collaborationRef.current.yTimeline.set('controlledBy', null);
          
          if (Math.abs(currentTime - duration) < 50) {
            collaborationRef.current.yTimeline.set('currentTime', 0);
          }
        });
      }
    } catch (error) {
      console.error("Error updating shared state:", error);
    }
  };

  const handleSeek = (e) => {
    const newTime = parseInt(e.target.value);
    
    if (Math.abs(newTime - currentTime) < 50) {
      return;
    }
    
    setHighlightRange(null);
    if (codeEditorRef.current && codeEditorRef.current.clearHighlight) {
      codeEditorRef.current.clearHighlight();
    }
    
    if (collaborationRef.current) {
      collaborationRef.current.clearCodeHighlight();
    }
    
    if (isPlaying) {
      setIsPlaying(false);
      
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }
    
    setCurrentTime(newTime);
    
    try {
      if (collaborationRef.current?.doc) {
        collaborationRef.current.doc.transact(() => {
          collaborationRef.current.yTimeline.set('isPlaying', false);
          collaborationRef.current.yTimeline.set('playbackController', null);
          collaborationRef.current.yState.set('operationApplier', null);
        });
        
        collaborationRef.current.doc.transact(() => {
          collaborationRef.current.yTimeline.set('currentTime', newTime);
        });
      }
    } catch (error) {
      console.error("Error updating shared state during seek:", error);
    }
  };

  const handleDragStart = () => {
    setHighlightRange(null);
    if (codeEditorRef.current && codeEditorRef.current.clearHighlight) {
      codeEditorRef.current.clearHighlight();
    }
    
    if (collaborationRef.current) {
      collaborationRef.current.clearCodeHighlight();
    }
    
    if (isPlaying) {
      setIsPlaying(false);
      
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }
    
    setIsSeeking(true);
    
    try {
      if (collaborationRef.current?.doc) {
        collaborationRef.current.doc.transact(() => {
          collaborationRef.current.yTimeline.set('isPlaying', false);
          collaborationRef.current.yTimeline.set('playbackController', null);
          collaborationRef.current.yState.set('operationApplier', null);
        });
        
        collaborationRef.current.doc.transact(() => {
          collaborationRef.current.yTimeline.set('controlledBy', session?.user?.email);
          collaborationRef.current.yTimeline.set('isSeeking', true);
          collaborationRef.current.yTimeline.set('seekingUser', session?.user?.email);
        });
      }
    } catch (error) {
      console.error("Error updating shared state during drag start:", error);
    }
  };
  
  const handleDragEnd = () => {
    setIsSeeking(false);
    
    try {
      if (collaborationRef.current?.doc) {
        collaborationRef.current.doc.transact(() => {
          collaborationRef.current.yTimeline.set('controlledBy', null);
          collaborationRef.current.yTimeline.set('isSeeking', false);
          collaborationRef.current.yTimeline.set('seekingUser', null);
          collaborationRef.current.yState.set('operationApplier', null);
        });
      }
    } catch (error) {
      console.error("Error updating shared state during drag end:", error);
    }
  };

  const reset = () => {
    if (isPlaying) {
      setIsPlaying(false);
      
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }
    
    setCurrentTime(0);
    
    try {
      if (collaborationRef.current?.doc) {
        collaborationRef.current.doc.transact(() => {
          collaborationRef.current.yTimeline.set('isPlaying', false);
          collaborationRef.current.yTimeline.set('playbackController', null);
          collaborationRef.current.yState.set('operationApplier', null);
        });
        
        collaborationRef.current.doc.transact(() => {
          collaborationRef.current.yTimeline.set('controlledBy', null);
          collaborationRef.current.yTimeline.set('currentTime', 0);
        });
      }
    } catch (error) {
      console.error("Error updating shared state during reset:", error);
    }
  };

  const linkCodeToNote = () => {
    if (activeTab !== "notes") return;
    
    const currentNotepadRef = role === 'interviewer' ? notepadRef.current : intervieweeNotepadRef.current;
    
    if (!currentNotepadRef) {
      console.error("Notepad not ready");
      return;
    }
    
    if (!selectedRange) {
      currentNotepadRef.setManualTimestamp();
      return;
    }
    
    try {
      const currentContent = codeEditorRef.current ? codeEditorRef.current.getCurrentContent() : "";
      const rangeWithContent = {
        ...selectedRange,
        contentSnapshot: currentContent
      };
      
      const success = currentNotepadRef.attachCodeRange(rangeWithContent);
      
      if (success === true) {
        console.log("Code linked successfully!");
      } else if (success === false) {
        console.log("Code linking was cancelled or failed");
      }
    } catch (error) {
      console.error("Error linking code:", error);
    }
  };

  const onUploadStatusChange = useCallback((status) => {
    console.log(`Upload status changed: ${status}`);
    
    if (status === 'loading_videos' || status === 'Loading recordings...') {
      setUploadStatus('loading_videos');
      return;
    }
    
    if (status === 'pending' || 
        status === 'uploading' || 
        status === 'uploading_final' || 
        status === 'preparing_final' ||
        status === 'processing_recordings' ||
        status.startsWith('retrying_upload_')) {
      setUploadStatus(status);
      return;
    }
    
    if (!status || status === '' || status === 'complete' || status === 'upload_complete') {
      setUploadStatus('complete');
      return;
    }
    
    if (status.includes('failed') || status.includes('corrupted')) {
      setUploadStatus(status);
      return;
    }
    
    setUploadStatus(status);
  }, []);

  const handleSelectionChange = useCallback((range) => {
    setSelectedRange(range);
  }, []);

  if (status === "loading") {
    return <div>Loading...</div>;
  }

  if (status === "unauthenticated") {
    return <div>Redirecting to login...</div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
        <Button 
          onClick={() => router.push('/dashboard')}
          variant="default"
          className="mt-4"
        >
          Return to Dashboard
        </Button>
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
          onUploadStatusChange={onUploadStatusChange}
          onVideoReady={(ready) => {
            setParticipants(prev => ({
              ...prev,
              [role]: { ...prev[role], videoReady: ready }
            }));
            
            if (socketService.socket?.connected) {
              socketService.socket.emit('video:ready', { 
                roomId,
                role,
                ready 
              });
            }
          }}
        />
        <div className="flex flex-row gap-5">
          <CodeEditor
            ref={codeEditorRef}
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
            roomState={roomState}
            onSelectionChange={handleSelectionChange}
            highlightRange={highlightRange}
          />
          {role === 'interviewer' ? (
            <InterviewerPanel
              startTimeRef={startTimeRef}
              roomState={roomState}
              endTimeRef={endTimeRef}
              notepadRef={notepadRef}
              handleTimestampClick={handleTimestampClick}
              currentTime={currentTime}
              archivedNotes={archivedNotes}
              archivedNoteLines={archivedNoteLines}
              handleSeek={handleSeek}
              handleLiveUpdate={handleLiveUpdate}
              collaborationService={collaborationRef.current}
              questionContent={archivedQuestionContent}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onCodeRangeClick={handleCodeRangeClick}
            />
          ) : (
            <IntervieweePanel
              collaborationService={collaborationRef.current}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              roomState={roomState}
              startTimeRef={startTimeRef}
              endTimeRef={endTimeRef}
              notepadRef={intervieweeNotepadRef}
              handleTimestampClick={handleTimestampClick}
              currentTime={currentTime}
              archivedNotes={intervieweeNotes}
              archivedNoteLines={intervieweeNoteLines}
              handleSeek={handleSeek}
              handleLiveUpdate={handleIntervieweeLiveUpdate}
              onCodeRangeClick={handleCodeRangeClick}
            />
          )}
        </div>
        {roomState === 'CREATED' && role === 'interviewer' && (
          <div className='flex flex-row gap-4 justify-start w-full'>
            <Button 
              onClick={startInterview}
              disabled={!bothParticipantsPresent || !bothVideosReady}
              variant="default"
            >
              {!bothParticipantsPresent 
                ? "Waiting for both participants..." 
                : !bothVideosReady
                ? "Waiting for video setup..."
                : "Start Interview"}
            </Button>
          </div>
        )}

        {roomState === 'ACTIVE' && role === 'interviewer' && (
          <div className='flex flex-row gap-4 justify-start w-full'>
            
            <Button 
              onClick={endInterview}
              variant="destructive"
            >
              End Interview
            </Button>
            {activeTab === "notes" && (
              <Button 
                onClick={linkCodeToNote}
                variant="secondary"
                disabled={activeTab !== "notes"}
                title={selectedRange ? "Link the selected code to the current note" : "Add a timestamped note"}
              >
                {selectedRange ? "Link Selected Code" : "Add Timestamp"}
              </Button>
            )}
          </div>
        )}
        
        {roomState === 'ARCHIVED' && (
          <div className='flex flex-row gap-4 justify-start w-full'>
            {activeTab === "notes" && (
              <Button 
                onClick={linkCodeToNote}
                variant="secondary"
                disabled={activeTab !== "notes"}
                title={selectedRange ? "Link the selected code to the current note" : "Add a timestamped note"}
              >
                {selectedRange ? "Link Selected Code" : "Add Timestamp"}
              </Button>
            )}
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
            uploadStatuses={uploadStatuses}
          />
        )}
      </div>

      <div className="flex flex-col gap-2 mt-4 w-full">
        {}
      </div>
    </div>
  );
};

export default InterviewRoom;
