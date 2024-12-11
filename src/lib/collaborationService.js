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
    this.isUpdating = false;
    
    // Connect to your websocket server
    this.provider = new WebsocketProvider(
      'ws://localhost:8080/yjs',
      roomId,
      this.doc
    );

    // Get text instance that will be shared
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
      lastUpdate: 0
    });

    this.extensions = [
      yCollab(this.yText, this.provider.awareness, {
        onUpdate: () => {
          // Only process updates if we're not currently updating
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

  // Timeline control methods
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
    if (this.yTimeline.get('controlledBy') !== this.userId) {
      return false;
    }

    // Prevent duplicate updates within a short time window
    if (time === this.lastAppliedTime) {
      return false;
    }

    // Clear any pending update
    if (this.updateDebounceTimeout) {
      clearTimeout(this.updateDebounceTimeout);
    }

    return new Promise((resolve) => {
      this.updateDebounceTimeout = setTimeout(() => {
        this.isUpdating = true;
        this.lastAppliedTime = time;
        this.yTimeline.set('currentTime', time);
        
        // Update awareness state to help prevent duplicate updates
        this.awareness.setLocalState({
          ...this.awareness.getLocalState(),
          lastUpdate: Date.now()
        });

        this.isUpdating = false;
        resolve(true);
      }, 30); // Debounce window
    });
  }

  onTimelineUpdate(callback) {
    this.yTimeline.observe(() => {
      const currentTime = this.yTimeline.get('currentTime');
      const controlledBy = this.yTimeline.get('controlledBy');
      
      // Only process the update if:
      // 1. We're not the controller, or
      // 2. This is a new time value we haven't processed yet
      if (controlledBy !== this.userId || currentTime !== this.lastAppliedTime) {
        this.lastAppliedTime = currentTime;
        callback({
          currentTime,
          controlledBy
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

  destroy() {
    if (this.updateDebounceTimeout) {
      clearTimeout(this.updateDebounceTimeout);
    }
    this.awareness.destroy();
    this.provider.destroy();
    this.doc.destroy();
  }
}

export default CollaborationService;