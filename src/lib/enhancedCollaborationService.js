import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { yCollab } from 'y-codemirror.next';
import { EditorView } from '@codemirror/view';
import TimelineState from '@/lib/timelineUpdateManager';

class CollaborationService {
  constructor(roomId, userId, role) {
    this.doc = new Y.Doc();
    this.roomId = roomId;
    this.userId = userId;
    this.role = role;
    
    this.timelineState = new TimelineState();
    
    this.updateQueue = [];
    this.processingQueue = false;
    
    this.timelineSubscribers = new Set();
    this.awarenessSubscribers = new Set();
    this.lastAwarenessUpdates = new Map();
    
    this.provider = new WebsocketProvider(
      `${process.env.NEXT_PUBLIC_WS_URL|| 'ws://localhost:8080/yjs'}`,
      roomId,
      this.doc
    );
    
    this.yText = this.doc.getText('codemirror');
    this.yTimeline = this.doc.getMap('timeline');
    this.yOperations = this.doc.getArray('operations');
    
    this.setupAwareness();
    
    this.setupObservers();
  }

  setupAwareness() {
    this.awareness = this.provider.awareness;
    
    const color = this.role === 'interviewer' ? '#E06C75' : '#56B6C2';
    
    this.awareness.setLocalState({
      user: {
        id: this.userId,
        role: this.role,
        name: `User ${this.userId}`,
        color: color,
      },
      timelineState: this.timelineState.currentState,
      lastUpdate: null
    });
  }

  setupObservers() {
    this.yTimeline.observe(event => {
      const remoteUpdate = this.yTimeline.get('currentTime');
      const updatedBy = this.yTimeline.get('updatedBy');
      
      if (updatedBy === this.userId) return;
      
      this.queueUpdate({
        time: remoteUpdate,
        source: updatedBy,
        timestamp: Date.now()
      });
    });

    this.awareness.on('change', changes => {
      const states = Array.from(this.awareness.getStates().values());
      this.handleAwarenessChange(states);
    });
  }

  handleAwarenessChange(states) {
    const otherStates = states.filter(state => 
      state.user?.id !== this.userId && state.user
    );

    for (const state of otherStates) {
      const lastKnownUpdate = this.lastAwarenessUpdates.get(state.user.id);
      if (!lastKnownUpdate || state.lastUpdate > lastKnownUpdate) {
        this.lastAwarenessUpdates.set(state.user.id, state.lastUpdate);

        if (state.timelineState !== undefined) {
          this.handleTimelineStateChange(state.user.id, state.timelineState);
        }

        this.notifyAwarenessSubscribers({
          userId: state.user.id,
          role: state.user.role,
          timelineState: state.timelineState,
          lastUpdate: state.lastUpdate
        });
      }
    }
  }

  onTimelineUpdate(callback) {
    this.timelineSubscribers.add(callback);
    
    return () => {
      this.timelineSubscribers.delete(callback);
    };
  }

  notifyTimelineSubscribers(update) {
    for (const subscriber of this.timelineSubscribers) {
      try {
        subscriber(update);
      } catch (error) {
        console.error('Error in timeline subscriber:', error);
      }
    }
  }

  subscribeToAwarenessChanges(callback) {
    this.awarenessSubscribers.add(callback);
    return () => this.awarenessSubscribers.delete(callback);
  }

  notifyAwarenessSubscribers(update) {
    for (const subscriber of this.awarenessSubscribers) {
      try {
        subscriber(update);
      } catch (error) {
        console.error('Error in awareness subscriber:', error);
      }
    }
  }

  queueUpdate(update) {
    this.updateQueue.push(update);
    
    if (!this.processingQueue) {
      this.processUpdateQueue();
    }
  }

  async processUpdateQueue() {
    if (this.processingQueue || this.updateQueue.length === 0) return;
    
    this.processingQueue = true;
    
    try {
      while (this.updateQueue.length > 0) {
        const update = this.updateQueue[0];
        
        if (this.lastUpdate && update.timestamp < this.lastUpdate) {
          this.updateQueue.shift();
          continue;
        }
        
        await this.applyTimelineUpdate(update);
        this.updateQueue.shift();
      }
    } finally {
      this.processingQueue = false;
    }
  }

  async applyTimelineUpdate(update) {
    this.timelineState.transition(this.timelineState.states.UPDATING, update);
    
    try {
      await this.updateTimeline(update.time, false);
      this.lastUpdate = update.timestamp;
      this.notifyTimelineSubscribers({
        time: update.time,
        state: this.timelineState.currentState,
        source: update.source
      });
    } finally {
      this.timelineState.transition(this.timelineState.states.IDLE);
    }
  }

  async updateTimeline(time, isLocal = true) {
    if (isLocal) {
      this.timelineState.transition(this.timelineState.states.UPDATING);
    }
    
    try {
      const update = {
        time,
        source: this.userId,
        timestamp: Date.now()
      };
      
      this.yTimeline.set('currentTime', time);
      this.yTimeline.set('updatedBy', this.userId);
      
      this.awareness.setLocalState({
        ...this.awareness.getLocalState(),
        lastUpdate: update.timestamp
      });

      this.notifyTimelineSubscribers({
        time,
        state: this.timelineState.currentState,
        source: this.userId
      });
      
      return true;
    } finally {
      if (isLocal) {
        this.timelineState.transition(this.timelineState.states.IDLE);
      }
    }
  }

  async requestTimelineControl() {
    if (this.timelineState.currentState !== this.timelineState.states.IDLE) {
      return false;
    }
    
    const currentController = this.yTimeline.get('controlledBy');
    if (currentController && currentController !== this.userId) {
      return false;
    }
    
    this.yTimeline.set('controlledBy', this.userId);
    return true;
  }

  releaseTimelineControl() {
    if (this.yTimeline.get('controlledBy') === this.userId) {
      this.yTimeline.set('controlledBy', null);
    }
  }

  startPlayback() {
    this.timelineState.transition(this.timelineState.states.PLAYING);
    this.notifyStateChange();
  }

  stopPlayback() {
    if (this.timelineState.currentState === this.timelineState.states.PLAYING) {
      this.timelineState.transition(this.timelineState.states.IDLE);
      this.notifyStateChange();
    }
  }

  startSeeking() {
    this.timelineState.transition(this.timelineState.states.SEEKING);
    this.notifyStateChange();
  }

  stopSeeking() {
    if (this.timelineState.currentState === this.timelineState.states.SEEKING) {
      this.timelineState.transition(this.timelineState.states.IDLE);
      this.notifyStateChange();
    }
  }

  notifyStateChange() {
    this.awareness.setLocalState({
      ...this.awareness.getLocalState(),
      timelineState: this.timelineState.currentState,
      lastUpdate: Date.now()
    });
  }

  getTimelineController() {
    return this.yTimeline.get('controlledBy');
  }

  getCurrentState() {
    return this.timelineState.currentState;
  }

  getExtensions() {
    return [
      yCollab(this.yText, this.provider.awareness),
      EditorView.updateListener.of(update => {
        if (update.docChanged && this.timelineState.currentState === this.timelineState.states.IDLE) {
          this.yOperations.push([{
            changes: update.changes,
            timestamp: Date.now()
          }]);
        }
      })
    ];
  }

  destroy() {
    this.timelineSubscribers.clear();
    this.awarenessSubscribers.clear();
    this.lastAwarenessUpdates.clear();
    this.awareness.destroy();
    this.provider.destroy();
    this.doc.destroy();
  }
}

export default CollaborationService;