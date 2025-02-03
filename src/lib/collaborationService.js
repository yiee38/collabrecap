import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { yCollab } from 'y-codemirror.next';
import { EditorView } from '@codemirror/view';

class CollaborationService {
  constructor(roomId, userId, role) {
    this.doc = new Y.Doc();
    this.roomId = roomId;
    this.userId = userId;
    this.role = role;
    this.isReplaying = false;
    this.replayController = null;
    this.lastAppliedTime = 0;
    this.updateDebounceTimeout = null;
    this.scrollDebounceTimeout = null;
    this.lastScrollTop = 0;
    this.isUpdating = false;
    
    this.provider = new WebsocketProvider(
      `${process.env.NEXT_PUBLIC_WS_URL|| 'ws://localhost:8080/yjs'}`,
      roomId,
      this.doc
    );

    this.yText = this.doc.getText('codemirror');
    this.yState = this.doc.getMap('interviewState');
    this.yTimeline = this.doc.getMap('timeline');

    if (!this.yState.get('status')) {
      this.yState.set('status', 'waiting');
    }
    if (!this.yTimeline.get('currentTime')) {
      this.yTimeline.set('currentTime', 0);
    }
    if (!this.yTimeline.get('controlledBy')) {
      this.yTimeline.set('controlledBy', null);
    }
    if (!this.yTimeline.get('isPlaying')) {
      this.yTimeline.set('isPlaying', false);
    }
    if (!this.yTimeline.get('playbackController')) {
      this.yTimeline.set('playbackController', null);
    }
    if (!this.yState.get('isReplaying')) {
      this.yState.set('isReplaying', false);
    }
    if (!this.yState.get('replayController')) {
      this.yState.set('replayController', null);
    }
    
    this.undoManager = new Y.UndoManager(this.yText);

    this.awareness = this.provider.awareness;
    
    let color = role === 'interviewer' ? '#E06C75' : '#56B6C2';

    this.awareness.setLocalState({
      user: {
        id: userId,
        role: role,
        name: `User ${userId}`,
        color: color,
      },
      timelineControl: false,
      lastUpdate: 0,
      mousePointer: null,
    });

    this.extensions = [
      yCollab(this.yText, this.provider.awareness, {
        onUpdate: (update) => {
          console.log('Yjs update');
          const clientId = update.origin?.client?.clientID;
          if (clientId) {
            const userState = this.awareness.getStates().get(clientId);
            if (userState) {
              console.log('Update made by:', {
                role: userState.user.role,
                name: userState.user.name,
                id: userState.user.id
              });
            }
          }
          if (!this.isUpdating) {
            this.undoManager.stopCapturing();
          }
        }
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !this.isUpdating) {
          this.undoManager.stopCapturing();
        }
      })
    ];

    this.timelineLock = false;
  }

  startInterview() {
    if (this.role !== 'interviewer') return false;
    this.yState.set('status', 'active');
    this.yState.set('startTime', Date.now());
    return true;
  }

  endInterview() {
    if (this.role !== 'interviewer') return false;
    this.yState.set('status', 'ended');
    this.yState.set('endTime', Date.now());
    return true;
  }

  startReplay(userId) {
    this.yState.set('isReplaying', true);
    this.yState.set('replayController', userId);
    this.isReplaying = true;
    this.replayController = userId;
  }

  stopReplay() {
    if (this.yState.get('replayController') === this.userId) {
      this.yState.set('isReplaying', false);
      this.yState.set('replayController', null);
      this.isReplaying = false;
      this.replayController = null;
    }
  }

  canEdit() {
    return !this.isReplaying || this.replayController === this.userId;
  }

  async requestTimelineControl() {
    if (this.yTimeline.get('controlledBy')) {
      return false;
    }
    
    this.yTimeline.set('controlledBy', this.userId);
    this.awareness.setLocalState({
      ...this.awareness.getLocalState(),
      timelineControl: true
    });
    return true;
  }

  releaseTimelineControl() {
    if (this.yTimeline.get('controlledBy') === this.userId) {
      this.yTimeline.set('controlledBy', null);
      this.awareness.setLocalState({
        ...this.awareness.getLocalState(),
        timelineControl: false
      });
    }
  }

  async updateTimeline(time) {
    const currentController = this.yTimeline.get('controlledBy');
    const playbackController = this.yTimeline.get('playbackController');
    const isPlaying = this.yTimeline.get('isPlaying');
    
    // Only allow updates if:
    // 1. We have explicit timeline control, or
    // 2. We are the playback controller and playback is active
    if (currentController !== this.userId && 
        !(playbackController === this.userId && isPlaying)) {
      return false;
    }

    if (currentController === this.userId && isPlaying) {
      this.setPlaying(false);
      this.yTimeline.set('playbackController', null);
    }

    if (time === this.lastAppliedTime) {
      return false;
    }

    if (this.updateDebounceTimeout) {
      clearTimeout(this.updateDebounceTimeout);
    }

    return new Promise((resolve) => {
      this.updateDebounceTimeout = setTimeout(() => {
        this.isUpdating = true;
        this.lastAppliedTime = time;
        this.yTimeline.set('currentTime', time);
        
        this.awareness.setLocalState({
          ...this.awareness.getLocalState(),
          lastUpdate: Date.now()
        });

        this.isUpdating = false;
        resolve(true);
      }, 30);
    });
  }
  

  updateMousePointer(pointer) {
    this.awareness.setLocalState({
      ...this.awareness.getLocalState(),
      mousePointer: {
        x: pointer.x,
        y: pointer.y,
        lineNumber: pointer.lineNumber,
        scrollTop: pointer.scrollTop,
        timestamp: Date.now()
      }
    });
  }

  updateScrollPosition(scrollTop) {
    if (Math.abs(this.lastScrollTop - scrollTop) < 5) return;

    if (this.scrollDebounceTimeout) {
      clearTimeout(this.scrollDebounceTimeout);
    }

    this.scrollDebounceTimeout = setTimeout(() => {
      this.lastScrollTop = scrollTop;
      const currentState = this.awareness.getLocalState();
      const currentPointer = currentState.mousePointer || {};
      
      this.awareness.setLocalState({
        ...currentState,
        mousePointer: {
          ...currentPointer,
          scrollTop,
          timestamp: Date.now()
        }
      });
    }, 16); 
  }
  
  onPointerUpdate(callback) {
    this.awareness.on('change', () => {
      const states = this.awareness.getStates();
      const pointers = {};
      states.forEach((state, clientId) => {
        if (state.mousePointer) {
          pointers[state.user.id] = {
            ...state.mousePointer,
            user: state.user
          };
        }
      });
      callback(pointers);
    });
  }

  setPlaying(isPlaying) {
    const currentController = this.yTimeline.get('controlledBy');
    const playbackController = this.yTimeline.get('playbackController');
    
    if (currentController === this.userId || playbackController === this.userId) {
      this.yTimeline.set('isPlaying', isPlaying);
    }
  }

  onTimelineUpdate(callback) {
    this.yTimeline.observe(() => {
      const currentTime = this.yTimeline.get('currentTime');
      const controlledBy = this.yTimeline.get('controlledBy');
      const isPlaying = this.yTimeline.get('isPlaying');
      
      if (controlledBy !== this.userId || currentTime !== this.lastAppliedTime || isPlaying !== undefined) {
        this.lastAppliedTime = currentTime;
        callback({
          currentTime,
          controlledBy,
          isPlaying
        });
      }
    });
  }

  onReplayStateChange(callback) {
    this.yState.observe(() => {
      this.isReplaying = this.yState.get('isReplaying');
      this.replayController = this.yState.get('replayController');
      callback({
        isReplaying: this.isReplaying,
        controller: this.replayController
      });
    });
  }

  onInterviewStateChange(callback) {
    this.yState.observe(() => {
      callback({
        status: this.yState.get('status'),
        startTime: this.yState.get('startTime'),
        endTime: this.yState.get('endTime')
      });
    });
  }

  getExtensions() {
    return this.extensions;
  }

  captureVersion() {
    return {
      content: this.yText.toString(),
      timestamp: Date.now()
    };
  }

  onTextUpdate(callback) {
    this.yText.observe(event => {
      const clientId = event.transaction.origin?.client?.clientID;
      if (clientId) {
        const userState = this.awareness.getStates().get(clientId);
        if (userState) {
          callback({
            delta: event.changes.delta,
            user: userState.user
          });
        }
      }
    });
  }

  destroy() {
    if (this.updateDebounceTimeout) {
      clearTimeout(this.updateDebounceTimeout);
    }
    if (this.scrollDebounceTimeout) {
      clearTimeout(this.scrollDebounceTimeout);
    }
    this.awareness.destroy();
    this.provider.destroy();
    this.doc.destroy();
  }
}

export default CollaborationService;
