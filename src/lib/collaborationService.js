// collaborationService.js
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
      this.yState.set('status', 'waiting'); // waiting -> active -> ended
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
    
    // Create the undo manager
    this.undoManager = new Y.UndoManager(this.yText);

    this.awareness = this.provider.awareness;
    
    let color = role === 'interviewer' ? '#E06C75' : '#56B6C2';

    // Set local state for awareness
    this.awareness.setLocalState({
      user: {
        id: userId,
        role: role,
        name: `User ${userId}`, // You can add actual username here
        color: color,
      },
      timelineControl: false
    });

    
    // Get the collaboration extensions
    this.extensions = [
      yCollab(this.yText, this.provider.awareness),
      // Enable undo/redo in collaboration
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          // Handle document changes
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

    return new Promise((resolve) => {
      // Add small delay to handle network lag
      setTimeout(() => {
        this.yTimeline.set('currentTime', time);
        resolve(true);
      }, 50);
    });
  }

  onTimelineUpdate(callback) {
    this.yTimeline.observe(() => {
      callback({
        currentTime: this.yTimeline.get('currentTime'),
        controlledBy: this.yTimeline.get('controlledBy')
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

  destroy() {
    this.awareness.destroy();
    this.provider.destroy();
    this.doc.destroy();
  }
}

export default CollaborationService;