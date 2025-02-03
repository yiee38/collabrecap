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
    const validTransitions = {
      [this.states.IDLE]: [this.states.PLAYING, this.states.SEEKING, this.states.UPDATING],
      [this.states.PLAYING]: [this.states.IDLE, this.states.SEEKING, this.states.UPDATING],
      [this.states.SEEKING]: [this.states.IDLE, this.states.PLAYING, this.states.UPDATING],
      [this.states.UPDATING]: [this.states.IDLE, this.states.PLAYING, this.states.SEEKING]
    };

    return validTransitions[fromState]?.includes(toState) || false;
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