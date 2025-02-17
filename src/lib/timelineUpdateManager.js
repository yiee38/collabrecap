class TimelineState {
  constructor() {
    this.states = {
      IDLE: 'IDLE',          
      PLAYING: 'PLAYING',     
      SEEKING: 'SEEKING',     
      UPDATING: 'UPDATING'    
    };
    
    this.currentState = this.states.IDLE;
    this.controller = null;
    this.lastUpdate = null;
    this.updateQueue = [];
  }

  canTransition(fromState, toState) {
    if (fromState === this.states.SEEKING) {
      return toState === this.states.IDLE;
    }
    return true;
  }

  transition(toState, meta = {}) {
    if (!this.canTransition(this.currentState, toState)) {
      throw new Error(`Invalid state transition from ${this.currentState} to ${toState}`);
    }
    
    const prevState = this.currentState;
    this.currentState = toState;
    return { prevState, currentState: toState, meta };
  }
}

export default TimelineState;