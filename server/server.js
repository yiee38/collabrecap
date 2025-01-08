// socketService.js
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const cors = require('cors');
const { setupWSConnection } = require('y-websocket/bin/utils');
const url = require('url');
const {MongoClient} = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(cors({
  origin: process.env.NEXT_PUBLIC_CLIENT_URL || "http://localhost:3000",
  methods: ['GET', 'POST']
}));
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.NEXT_PUBLIC_CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  },
  path: '/socket.io'
});

// Set up WebSocket server for Yjs with path
const wss = new WebSocket.Server({ 
  noServer: true,
  verifyClient: ({origin}, cb) => {
    const allowedOrigins = [process.env.NEXT_PUBLIC_CLIENT_URL || "http://localhost:3000"]; 
    const isAllowed = allowedOrigins.includes(origin);
    cb(isAllowed, 403, 'Origin not allowed');
  }
});

httpServer.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url).pathname;
  if (pathname.startsWith('/yjs')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

wss.on('connection', (conn, req) => {
  const pathname = url.parse(req.url).pathname;
  const roomMatch = pathname.match(/\/yjs\/([^\/]+)/);
  const room = roomMatch ? roomMatch[1] : '';

  console.log('Yjs client connecting to room:', room);
  conn.binaryType = 'nodebuffer';

  conn.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  conn.on('close', () => {
    console.log('Yjs client disconnected from room:', room);
  });

  try {
    setupWSConnection(conn, req, {
      docName: room,
      gc: true,
      onConnect: (doc) => {
        console.log('Yjs client connected to room:', room);
      },
      onDisconnect: (doc) => {
        console.log('Yjs client disconnected from room:', room);
      },
      onError: (err) => {
        console.error('Yjs error:', err);
      }
    });
  } catch (e) {
    console.error('Error setting up Yjs connection:', e);
    conn.close();
  }
});

// Mongodb set up
const connectionString = process.env.ATLAS_URI || "";
const client = new MongoClient(connectionString);

// In-memory store for active rooms
const activeRooms = new Map();

class Room {
  constructor(id, creatorId) {
    this.id = id;
    this.state = 'CREATED';
    this.roles = {
      interviewer: creatorId,
      interviewee: null
    };
    this.createdAt = Date.now();
    this.startedAt = null;
    this.endedAt = null;
    this.codeOperations = [];  // Only set when interview ends
    this.noteContent = '';     // Full text content
    this.noteLines = [];       // Array of line data with timestamps
  }

  canJoin(userId, role) {
    if (this.roles[role] && this.roles[role] !== userId) {
      return { 
        allowed: false, 
        reason: `${role} role is already taken` 
      };
    }

    const otherRole = role === 'interviewer' ? 'interviewee' : 'interviewer';
    if (this.roles[otherRole] === userId) {
      return { 
        allowed: false, 
        reason: 'Already joined in another role' 
      };
    }

    return { allowed: true };
  }

  assignRole(userId, role) {
    if (role === 'interviewer' || role === 'interviewee') {
      this.roles[role] = userId;
    }
  }

  removeParticipant(userId) {
    if (this.roles.interviewer === userId) {
      this.roles.interviewer = null;
    }
    if (this.roles.interviewee === userId) {
      this.roles.interviewee = null;
    }
  }

  start() {
    if (this.state !== 'CREATED') return false;
    if (!this.hasAllParticipants()) return false;
    
    this.state = 'ACTIVE';
    this.startedAt = Date.now();
    return true;
  }

  archive(operations) {
    this.state = 'ARCHIVED';
    this.endedAt = Date.now();
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
      roles: this.roles,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      codeOperations: this.codeOperations,
      noteContent: this.noteContent,
      noteLines: this.noteLines
    };
  }

  updateNote(content, lineNumbers) {
    if (this.state !== 'ACTIVE') return false;
    this.noteContent = content;
    this.noteLines = lineNumbers;  // Already has timestamps from frontend
    return true;
  }

  hasAllParticipants() {
    return this.roles.interviewer && this.roles.interviewee;
  }

  getParticipantRole(userId) {
    if (this.roles.interviewer === userId) return 'interviewer';
    if (this.roles.interviewee === userId) return 'interviewee';
    return null;
  }
}

client.connect().then(async () => {
  console.log('Connected to MongoDB');
  const db = client.db("collabrecap");
  const roomsCollection = db.collection('archivedRooms');

  // Create indexes
  await roomsCollection.createIndex({ id: 1 }, { unique: true });
  await roomsCollection.createIndex({ "roles.interviewer": 1 });
  await roomsCollection.createIndex({ "roles.interviewee": 1 });
  await roomsCollection.createIndex({ createdAt: 1 });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.data = {
      userId: null,
      roomId: null,
      role: null
    };
    
    socket.on('room:create', ({ userId }) => {
      const roomId = uuidv4();
      const room = new Room(roomId, userId);
      activeRooms.set(roomId, room);
      socket.emit('room:created', { roomId, room: room.serialize() });
    });
  
    socket.on('room:join', ({ roomId, userId, role }) => {
      const room = activeRooms.get(roomId);
      
      if (!room) {
        socket.emit('error', { 
          type: 'ROOM_ERROR',
          message: 'Room not found' 
        });
        return;
      }
  
      const joinCheck = room.canJoin(userId, role);
      if (!joinCheck.allowed) {
        socket.emit('error', { 
          type: 'JOIN_ERROR',
          message: joinCheck.reason 
        });
        return;
      }
  
      socket.data.userId = userId;
      socket.data.roomId = roomId;
      socket.data.role = role;
      
      socket.join(roomId);
      room.assignRole(userId, role);
      
      io.to(roomId).emit('room:status', room.serialize());
      socket.to(roomId).emit('room:user_joined', { userId, role });
    });
  
    socket.on('room:start', ({ roomId, userId }) => {
      const room = activeRooms.get(roomId);
      
      if (!room || room.roles.interviewer !== userId) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      if (!room.hasAllParticipants()) {
        socket.emit('error', { message: 'Waiting for all participants' });
        return;
      }
  
      if (room.start()) {
        io.to(roomId).emit('room:status', room.serialize());
      }
    });
  
    socket.on('room:end', async ({ roomId, userId, operations, duration }) => {
      const room = activeRooms.get(roomId);
    
      if (!room || room.roles.interviewer !== userId) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }
    
      const endTime = Date.now();
      room.endedAt = endTime;
      
      const archived = room.archive(operations);
      archived.duration = duration;
      archived.endTime = endTime;
      
      io.to(roomId).emit('room:ended', {
        endTime,
        duration,
        state: 'ARCHIVED'
      });
      
      io.to(roomId).emit('room:status', archived);

      try {
        await roomsCollection.insertOne({
          ...archived,
          codeOperations: operations || [],  // Use operations from end event
          noteLines: archived.noteLines      // Already has proper timestamps
        });
        activeRooms.delete(roomId);
      } catch (error) {
        console.error('Error archiving room:', error);
        socket.emit('error', { message: 'Failed to archive room' });
      }
    });
  
    socket.on('note:add', ({ note, lineNumbers }) => {
      const { userId, roomId, role } = socket.data;
      const room = activeRooms.get(roomId);
      if (room && role === 'interviewer') {
        console.log('Saving note:', { content: note, lines: lineNumbers });
        if (room.updateNote(note, lineNumbers)) {
          io.to(roomId).emit('note:sync', { content: note, lines: lineNumbers });
        }
      }
    });
  
    socket.on('webrtc:signal', ({ roomId, signal }) => {
      socket.to(roomId).emit('webrtc:signal', signal);
    });
  
    socket.on('disconnect', async () => {
      console.log('Client disconnected:', socket.id);
  
      const { userId, roomId, role } = socket.data;
      
      if (userId && roomId) {
        const room = activeRooms.get(roomId);
        if (room) {
          if (room.state === 'ACTIVE') {
            const archived = room.archive();
            io.to(roomId).emit('room:status', archived);
            try {
              await roomsCollection.insertOne({
                ...archived,
                noteLines: archived.noteLines  // Already has proper timestamps
              });
            } catch (error) {
              console.error('Error archiving room:', error);
            }
            activeRooms.delete(roomId);
          } else {
            room.removeParticipant(userId);
            io.to(roomId).emit('room:status', room.serialize());
            io.to(roomId).emit('room:user_left', { userId, role });
          }
        }
      }
    });
  });
});

wss.on('error', (error) => {
  console.error('WebSocket Server Error:', error);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.io on /socket.io`);
  console.log(`Yjs WebSocket server on /yjs`);
});
