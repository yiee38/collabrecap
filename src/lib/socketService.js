import io from 'socket.io-client';

class SocketService {
  constructor() {
    this.socket = null;
    this.room = null;
  }

  connect(serverUrl) {
    if (this.socket?.connected) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      try {
        const options = process.env.NODE_ENV === 'production' ? {
          path: '/research/socket.io'
        } : {};
        
        this.socket = io(serverUrl, options);

        this.socket.on('connect', () => {
          console.log('Connected to server');
          resolve();
        });

        this.socket.on('connect_error', (error) => {
          console.error('Connection error:', error);
          resolve();
        });

        this.socket.on('error', (error) => {
          console.error('Socket error:', error);
        });
      } catch (err) {
        console.error('Socket initialization error:', err);
        reject(err);
      }
    });
  }

  joinRoom(roomId, userId, role) {
    if (!this.socket?.connected) {
      console.error('Socket not connected');
      return;
    }
    this.socket.emit('room:join', { roomId, userId, role });
  }

  pushNote(note, lineNumbers) {
    if (!this.socket?.connected) {
      console.error('Socket not connected');
      return;
    }
    console.log('pushNote:', note, lineNumbers);
    this.socket.emit('note:add', { note, lineNumbers });
  }

  pushInterviewerNote(note, lineNumbers) {
    if (!this.socket?.connected) {
      console.error('Socket not connected');
      return;
    }
    console.log('pushInterviewerNote:', note, lineNumbers);
    this.socket.emit('interviewer:note:add', { note, lineNumbers });
  }

  pushIntervieweeNote(note, lineNumbers) {
    if (!this.socket?.connected) {
      console.error('Socket not connected');
      return;
    }
    console.log('pushIntervieweeNote:', note, lineNumbers);
    this.socket.emit('interviewee:note:add', { note, lineNumbers });
  }

  shareMuteState(roomId, isMuted, userId) {
    if (!this.socket?.connected) {
      console.error('Socket not connected');
      return;
    }
    console.log('shareMuteState:', { roomId, isMuted, userId });
    this.socket.emit('video:mute:sync', { roomId, isMuted, userId });
  }

  onMuteStateChange(callback) {
    this.socket?.on('video:mute:receive', callback);
  }

  onRoomStatus(callback) {
    this.socket?.on('room:status', callback);
  }

  onError(callback) {
    this.socket?.on('error', (error) => {
      console.error('Socket error:', error);
      callback(error);
    });
  }

  emitCodeChange(roomId, operation) {
    if (!this.socket?.connected) {
      console.error('Socket not connected');
      return;
    }
    this.socket.emit('code:change', { roomId, operation });
  }

  onCodeSync(callback) {
    this.socket?.on('code:sync', callback);
  }

  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export const socketService = new SocketService();
