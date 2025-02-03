class Room {
  constructor(id, interviewerId) {
    this.id = id;
    this.state = 'CREATED';
    this.capacity = 2;
    this.roles = {
      interviewer: interviewerId,
      interviewee: null
    };
    this.interviewerId = interviewerId;
    this.intervieweeId = null;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.endedAt = null;
    this.codeOperations = [];
    this.notes = [];
    this.participants = new Set();
    this.note = '';
    this.lineNumber = [];
    this.recordings = [];
  }

  canJoin(userId, role) {
    if (this.participants.size >= this.capacity) {
      return { 
        allowed: false, 
        reason: 'Room is full' 
      };
    }

    if (this.participants.has(userId)) {
      return { 
        allowed: false, 
        reason: 'User already in room' 
      };
    }

    if (role === 'interviewer') {
      if (this.roles.interviewer && this.roles.interviewer !== userId) {
        return { 
          allowed: false, 
          reason: 'Interviewer role is taken' 
        };
      }
    } else if (role === 'interviewee') {
      if (this.roles.interviewee && this.roles.interviewee !== userId) {
        return { 
          allowed: false, 
          reason: 'Interviewee role is taken' 
        };
      }
    }

    return { allowed: true };
  }

  assignRole(userId, role) {
    if (role === 'interviewee') {
      this.roles.interviewee = userId;
    }
  }

  addParticipant(userId) {
    this.participants.add(userId);
    return this.participants.size;
  }

  removeParticipant(userId) {
    this.participants.delete(userId);
    return this.participants.size;
  }

  start() {
    if (this.state !== 'CREATED') return false;
    this.state = 'ACTIVE';
    this.startedAt = Date.now();
    return true;
  }

  archive(operations, endTime) {
    this.state = 'ARCHIVED';
    this.endedAt = endTime || Date.now();
    if (operations) {
      this.codeOperations = operations;
    }
    console.log('Room archived:', this.id);
    return this.serialize();
  }

  serialize() {
    return {
      id: this.id,
      state: this.state,
      interviewerId: this.interviewerId,
      intervieweeId: this.intervieweeId,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      codeOperations: this.codeOperations,
      notes: this.notes,
      note: this.note,
      lineNumber: this.lineNumber,
      participants: Array.from(this.participants),
      roles: this.roles,
      recordings: this.recordings,
    };
  }

  addCodeOperation(operation) {
    if (this.state !== 'ACTIVE') return false;
    
    const timestamp = Date.now() - this.startedAt;
    this.codeOperations.push({
      ...operation,
      timestamp
    });
    return true;
  }

  addRecording(recordingId, userId, role) {
    this.recordings.push({
      id: recordingId,
      userId,
      role,
      timestamp: Date.now()
    });
  }

  addNote(note, lineNumber) {
    if (this.state !== 'ACTIVE') return false;
    
    this.note = note;
    this.lineNumber = lineNumber;

    return true;
  }
}
