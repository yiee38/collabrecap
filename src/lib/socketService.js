// socketService.js
import io from 'socket.io-client';

class SocketService {
  constructor() {
    this.socket = null;
    this.room = null;
  }

  connect(serverUrl) {
    this.socket = io(serverUrl);
    this.setupListeners();
  }

  setupListeners() {
    this.socket.on('connect', () => {
      console.log('Connected to server');
    });

    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  }

  joinRoom(roomId, userId, role) {
    this.socket.emit('room:join', { roomId, userId, role });
  }

  onRoomStatus(callback) {
    this.socket.on('room:status', callback);
  }

  emitCodeChange(roomId, operation) {
    this.socket.emit('code:change', { roomId, operation });
  }

  onCodeSync(callback) {
    this.socket.on('code:sync', callback);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

export const socketService = new SocketService();