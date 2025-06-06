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
    this.yHighlights = this.doc.getMap('codeHighlights');

    this.doc.transact(() => {
      if (!this.yState.get('status')) {
        this.yState.set('status', 'waiting');
      }
      if (!this.yState.get('operationApplier')) {
        this.yState.set('operationApplier', null);
      }
      if (!this.yState.get('operationsInitialized')) {
        this.yState.set('operationsInitialized', false);
      }
      if (!this.yState.get('operationsInitializer')) {
        this.yState.set('operationsInitializer', null);
      }
      if (!this.yState.get('transitionTimestamp')) {
        this.yState.set('transitionTimestamp', null);
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
      if (!this.yHighlights.get('currentHighlight')) {
        this.yHighlights.set('currentHighlight', null);
      }
      if (!this.yHighlights.get('highlightedBy')) {
        this.yHighlights.set('highlightedBy', null);
      }
      if (!this.yHighlights.get('highlightTimestamp')) {
        this.yHighlights.set('highlightTimestamp', null);
      }
    });
    
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
    this.yTimeline.set('isSeeking', true);
    this.yTimeline.set('seekingUser', userId);
  }

  stopReplay() {
    if (this.yState.get('replayController') === this.userId) {
      this.yState.set('isReplaying', false);
      this.yState.set('replayController', null);
      this.isReplaying = false;
      this.replayController = null;
      this.yTimeline.set('isSeeking', false);
      this.yTimeline.set('seekingUser', null);
    }
  }

  canEdit() {
    return !this.isReplaying || this.replayController === this.userId;
  }

  async requestTimelineControl() {
    const currentController = this.yTimeline.get('controlledBy');
    if (currentController && currentController !== this.userId && this.yState.get('isReplaying')) {
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
    
    if (currentController && 
        currentController !== this.userId && 
        !(playbackController === this.userId && isPlaying)) {
      return false;
    }

    if (this.isUpdating || 
        time === this.lastAppliedTime || 
        Math.abs(time - this.lastAppliedTime) < 50) {
      return false;
    }

    this.isUpdating = true;

    try {
      if (this.updateDebounceTimeout) {
        clearTimeout(this.updateDebounceTimeout);
      }

      await new Promise((resolve) => {
        this.updateDebounceTimeout = setTimeout(() => {
          this.doc.transact(() => {
            this.lastAppliedTime = time;
            this.yTimeline.set('currentTime', time);
            
            if (Math.abs(time - this.lastAppliedTime) >= 50) {
              this.awareness.setLocalState({
                ...this.awareness.getLocalState(),
                lastUpdate: Date.now()
              });
            }
          });
          resolve();
        }, 30);
      });

      return true;
    } finally {
      setTimeout(() => {
        this.isUpdating = false;
      }, 50);
    }
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
    const currentApplier = this.yState.get('operationApplier');
    const transitionTimestamp = this.yState.get('transitionTimestamp');
    const currentTime = Date.now();
    const inTransition = transitionTimestamp && (currentTime - transitionTimestamp <= 5000);
    
    if (!isPlaying || currentController === this.userId || playbackController === this.userId) {
      this.doc.transact(() => {
        this.yTimeline.set('isPlaying', isPlaying);
        if (!isPlaying) {
          this.yTimeline.set('playbackController', null);
          if (!inTransition || this.role !== 'interviewer') {
            this.yState.set('operationApplier', null);
          }
        } else if (isPlaying && playbackController !== this.userId) {
          this.yTimeline.set('playbackController', this.userId);
          if (!currentApplier || (inTransition && this.role === 'interviewer')) {
            this.yState.set('operationApplier', this.userId);
          }
        }
      });
    }
  }

  isInTransition() {
    const transitionTimestamp = this.yState.get('transitionTimestamp');
    const currentTime = Date.now();
    return transitionTimestamp && (currentTime - transitionTimestamp <= 5000);
  }

  onTimelineUpdate(callback) {
    let lastUpdate = {
      currentTime: this.yTimeline.get('currentTime'),
      controlledBy: this.yTimeline.get('controlledBy'),
      isPlaying: this.yTimeline.get('isPlaying'),
      isSeeking: this.yTimeline.get('isSeeking'),
      seekingUser: this.yTimeline.get('seekingUser')
    };

    this.yTimeline.observe(() => {
      const currentTime = this.yTimeline.get('currentTime');
      const controlledBy = this.yTimeline.get('controlledBy');
      const isPlaying = this.yTimeline.get('isPlaying');
      const isSeeking = this.yTimeline.get('isSeeking');
      const seekingUser = this.yTimeline.get('seekingUser');
      
      if (controlledBy !== lastUpdate.controlledBy || 
          currentTime !== lastUpdate.currentTime || 
          isPlaying !== lastUpdate.isPlaying ||
          isSeeking !== lastUpdate.isSeeking ||
          seekingUser !== lastUpdate.seekingUser) {
        
        lastUpdate = { currentTime, controlledBy, isPlaying, isSeeking, seekingUser };
        
        if (controlledBy !== this.userId || 
            currentTime !== this.lastAppliedTime || 
            isPlaying !== undefined) {
          callback(lastUpdate);
        }
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
        isReplaying: this.yState.get('isReplaying'),
        replayController: this.yState.get('replayController')
      });
    });
  }

  onStateChange(callback) {
    const observer = () => {
      callback({
        operationsInitialized: this.yState.get('operationsInitialized'),
        operationsInitializer: this.yState.get('operationsInitializer')
      });
    };
    
    this.yState.observe(observer);
    
    return () => {
      this.yState.unobserve(observer);
    };
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

  shareCodeHighlight(range, timestamp = null) {
    if (!range || typeof range.from !== 'number' || typeof range.to !== 'number') {
      console.warn('Invalid range provided to shareCodeHighlight:', range);
      return false;
    }

    console.log(`${this.role} sharing highlight:`, { range, timestamp });
    
    this.doc.transact(() => {
      this.yHighlights.set('currentHighlight', {
        from: range.from,
        to: range.to,
        text: range.text || ''
      });
      this.yHighlights.set('highlightedBy', this.userId);
      this.yHighlights.set('highlightTimestamp', timestamp);
      this.yHighlights.set('lastUpdate', Date.now());
    });
    
    return true;
  }

  clearCodeHighlight() {
    console.log(`${this.role} clearing highlight`);
    
    this.doc.transact(() => {
      this.yHighlights.set('currentHighlight', null);
      this.yHighlights.set('highlightedBy', this.userId);
      this.yHighlights.set('highlightTimestamp', null);
      this.yHighlights.set('lastUpdate', Date.now());
    });
  }

  onHighlightChange(callback) {
    let lastHighlight = {
      currentHighlight: this.yHighlights.get('currentHighlight'),
      highlightedBy: this.yHighlights.get('highlightedBy'),
      highlightTimestamp: this.yHighlights.get('highlightTimestamp'),
      lastUpdate: this.yHighlights.get('lastUpdate')
    };

    this.yHighlights.observe(() => {
      const currentHighlight = this.yHighlights.get('currentHighlight');
      const highlightedBy = this.yHighlights.get('highlightedBy');
      const highlightTimestamp = this.yHighlights.get('highlightTimestamp');
      const lastUpdate = this.yHighlights.get('lastUpdate');
      
      if ((currentHighlight !== lastHighlight.currentHighlight || 
          highlightTimestamp !== lastHighlight.highlightTimestamp ||
          lastUpdate !== lastHighlight.lastUpdate) &&
          highlightedBy !== this.userId) {
        
        lastHighlight = { currentHighlight, highlightedBy, highlightTimestamp, lastUpdate };
        
        console.log(`Received highlight change from ${highlightedBy}:`, {
          highlight: currentHighlight,
          timestamp: highlightTimestamp
        });
        
        callback({
          range: currentHighlight,
          timestamp: highlightTimestamp,
          fromUser: highlightedBy,
          action: currentHighlight ? 'highlight' : 'clear'
        });
      }
    });
  }

  getCurrentHighlight() {
    return {
      range: this.yHighlights.get('currentHighlight'),
      highlightedBy: this.yHighlights.get('highlightedBy'),
      timestamp: this.yHighlights.get('highlightTimestamp')
    };
  }
}

export default CollaborationService;
