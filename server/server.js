const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');
const url = require('url');  // You'll need this for pathname parsing
const {MongoClient} = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });  // Load root .env
require('dotenv').config({ path: path.join(__dirname, '.env') });    




const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.NEXT_PUBLIC_CLIENT_URL || "http://localhost:3000", // Your frontend URL
    methods: ["GET", "POST"]
  },
  path: '/socket.io' // Explicitly set Socket.io path
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

  // Handle close
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
  constructor(id, interviewerId) {
    this.id = id;
    this.state = 'CREATED';
    this.capacity = 2; // Maximum 2 people per room
    this.roles = {
      interviewer: interviewerId,  // Store interviewer ID immediately
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
  }

  canJoin(userId, role) {
    // Check if room is full
    if (this.participants.size >= this.capacity) {
      return { 
        allowed: false, 
        reason: 'Room is full' 
      };
    }

    // Check if user is already in room
    if (this.participants.has(userId)) {
      return { 
        allowed: false, 
        reason: 'User already in room' 
      };
    }

    // Check role availability
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
    // Interviewer role is assigned in constructor
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

  archive() {
    this.state = 'ARCHIVED';
    this.endedAt = Date.now();
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

  addNote(note, lineNumber) {
    if (this.state !== 'ACTIVE') return false;
    
    //const timestamp = Date.now() - this.startedAt;
    this.note = note;
    this.lineNumber = lineNumber;
    /*
    this.notes.push({
      ...note,
      timestamp
    });
    */
    return true;
  }
}

client.connect().then(async () => {
  console.log('Connected to MongoDB');
  const db = client.db("collabrecap");

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.data = {
      userId: null,
      roomId: null,
      role: null
    };
    
    // Create new room
    socket.on('room:create', ({ userId }) => {
      const roomId = uuidv4();
      const room = new Room(roomId, userId);
      activeRooms.set(roomId, room);
      room.assignRole(userId, 'interviewer');
      
      socket.emit('room:created', { roomId, room: room.serialize() });
    });
  
    // Join room
    socket.on('room:join', ({ roomId, userId, role }) => {
      const room = activeRooms.get(roomId);
  
      
      if (!room) {
        socket.emit('error', { 
          type: 'ROOM_ERROR',
          message: 'Room not found' 
        });
        return;
      }
  
      socket.data.userId = userId;
      socket.data.roomId = roomId;
      socket.data.role = role;
      
      // Check if can join
      const joinCheck = room.canJoin(userId, role);
      if (!joinCheck.allowed) {
        socket.emit('error', { 
          type: 'JOIN_ERROR',
          message: joinCheck.reason 
        });
        return;
      }
  
      // All checks passed, proceed with join
      socket.join(roomId);
      room.addParticipant(userId);
      room.assignRole(userId, role);
      
      // Notify all room participants of the new state
      io.to(roomId).emit('room:status', {
        ...room.serialize(),
        participants: Array.from(room.participants),
        roles: room.roles
      });
  
      // Optional: Notify others that someone joined
      socket.to(roomId).emit('room:user_joined', {
        userId,
        role,
        timestamp: Date.now()
      });
    });
  
    // Start interview
    socket.on('room:start', ({ roomId, userId }) => {
      const room = activeRooms.get(roomId);
      
      if (!room || room.interviewerId !== userId) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }
  
      if (room.start()) {
        io.to(roomId).emit('room:status', room.serialize());
      }
    });
  
  
    // Handle room end
    socket.on('room:end', ({ roomId, userId, operations, duration }) => {
      const room = activeRooms.get(roomId);
    
      if (!room || room.interviewerId !== userId) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }
    
      // Set explicit end time that both parties will use
      const endTime = Date.now();
      room.endedAt = endTime;
      
      // Archive with explicit duration and end time
      const archived = room.archive();
      archived.duration = duration;
      archived.endTime = endTime;
      
      // Broadcast to all clients with the same end time
      io.to(roomId).emit('room:ended', {
        endTime,
        duration,
        state: 'ARCHIVED'
      });
      
      // Then broadcast the full room status
      io.to(roomId).emit('room:status', archived);
    });
  
    // Handle code changes
    socket.on('code:change', ({ roomId, operation }) => {
      const room = activeRooms.get(roomId);
      
      if (room?.addCodeOperation(operation)) {
        socket.to(roomId).emit('code:sync', operation);
      }
    });
  
    // Handle notes
    socket.on('note:add', ({  note, lineNumbers }) => {
      const { userId, roomId, role } = socket.data;
      const room = activeRooms.get(roomId);
      if (room) {
        console.log('Note added:', note, lineNumbers);
        let addNoteResult = room.addNote(note, lineNumbers);
        if (addNoteResult && room?.interviewerId === userId) {
          io.to(roomId).emit('note:sync');
        }

      }
    });
  
    // WebRTC signaling
    socket.on('webrtc:signal', ({ roomId, signal }) => {
      socket.to(roomId).emit('webrtc:signal', signal);
    });
  
    socket.on('disconnect', async () => {
      console.log('Client disconnected:', socket.id);
  
      const { userId, roomId, role } = socket.data;
      
      if (userId && roomId) {
        const room = activeRooms.get(roomId);
        if (room) {
          // If room is ACTIVE, archive it immediately when anyone disconnects
          if (room.state === 'ACTIVE') {
            const archived = room.archive();
            io.to(roomId).emit('room:status', archived);
            //TODO save room to database then delete
            //activeRooms.delete(roomId);
            const roomsDb = db.collection('archivedRooms');   
            await roomsDb.insertOne(archived);
            activeRooms.delete(roomId);
  
          }
          if (role === 'interviewer' && room.roles.interviewer === userId) {
            room.roles.interviewer = null;
          }
          if (role === 'interviewee' && room.roles.interviewee === userId) {
            room.roles.interviewee = null;
          }
  
  
  
          room.removeParticipant(userId);
  
  
          io.to(roomId).emit('room:status', room.serialize());
        }
        
      }
    });
  });
});

wss.on('error', (error) => {
  console.error('WebSocket Server Error:', error);
});


// API endpoints for archived sessions
app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = activeRooms.get(roomId);
  
  if (room) {
    res.json(room.serialize());
  } else {
    // Here you would fetch archived room from database
    res.status(404).json({ message: 'Room not found' });
  }
});

// Add basic health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});


const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.io on /socket.io`);
  console.log(`Yjs WebSocket server on /yjs`);

});