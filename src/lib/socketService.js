// socketService.js
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
        this.socket = io(serverUrl);

        this.socket.on('connect', () => {
          console.log('Connected to server');
          resolve();
        });

        this.socket.on('connect_error', (error) => {
          console.error('Connection error:', error);
          // Don't reject on connect error, might be archived room
          resolve();
        });

        this.socket.on('error', (error) => {
          console.error('Socket error:', error);
          // Don't reject on socket error, let error handler deal with it
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
