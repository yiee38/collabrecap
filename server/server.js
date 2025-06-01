const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const cors = require('cors');
const { setupWSConnection } = require('y-websocket/bin/utils');
const url = require('url');
const {MongoClient, ObjectId, GridFSBucket} = require('mongodb');
const path = require('path');
const { initRecordingService } = require('./recordingServer');
const { initTestUploadService } = require('./testUploadService');
const multer = require('multer');
const { Readable } = require('stream');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(cors({
  origin: process.env.NEXT_PUBLIC_CLIENT_URL || "http://localhost:3000",
  methods: ['GET', 'POST']
}));
const httpServer = createServer(app);

const isProd = process.env.NODE_ENV === 'production';

const io = new Server(httpServer, {
  cors: {
    origin: process.env.NEXT_PUBLIC_CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  },
  path: isProd ? '/research/socket.io' : '/socket.io',
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  debug: true
});

console.log('Client URL:', process.env.NEXT_PUBLIC_CLIENT_URL);

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
  const pathMatch = isProd ? '/research/yjs' : '/yjs';
  if (pathname.startsWith(pathMatch)) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

wss.on('connection', (conn, req) => {
  const pathname = url.parse(req.url).pathname;
  const pathRegex = isProd ? /\/research\/yjs\/([^\/]+)/ : /\/yjs\/([^\/]+)/;
  const roomMatch = pathname.match(pathRegex);

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

const connectionString = process.env.ATLAS_URI || "";
const client = new MongoClient(connectionString);

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
    this.codeOperations = [];
    this.noteContent = '';
    this.noteLines = [];
    this.intervieweeNoteContent = '';
    this.intervieweeNoteLines = [];
    this.questionContent = '';
    this.recordings = [];
    this.uploadStatus = {
      interviewer: false,
      interviewee: false
    };
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

  archive(operations, questionContent) {
    this.state = 'ARCHIVED';
    this.endedAt = Date.now();
    if (operations) {
      this.codeOperations = operations;
    }
    if (questionContent) {
      this.questionContent = questionContent;
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
      noteLines: this.noteLines,
      intervieweeNoteContent: this.intervieweeNoteContent,
      intervieweeNoteLines: this.intervieweeNoteLines,
      questionContent: this.questionContent,
      recordings: this.recordings,
      uploadStatus: this.uploadStatus
    };
  }

  updateNote(content, lineNumbers) {
    if (this.state !== 'ACTIVE' && this.state !== 'ARCHIVED') return false;
    
    this.noteContent = content;
    this.noteLines = lineNumbers;
    
    client.db("collabrecap").collection('archivedRooms').updateOne(
      { id: this.id },
      { $set: { noteContent: content, noteLines: lineNumbers } },
      { upsert: true }
    ).catch(err => console.error('Error updating room notes:', err));
    
    return true;
  }

  updateQuestionContent(content) {
    if (this.state !== 'ACTIVE' && this.state !== 'ARCHIVED') return false;
    
    this.questionContent = content;
    
    client.db("collabrecap").collection('archivedRooms').updateOne(
      { id: this.id },
      { $set: { questionContent: content } },
      { upsert: true }
    ).catch(err => console.error('Error updating question content:', err));
    
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

  addRecording(recordingId, userId, role) {
    this.recordings.push({
      id: recordingId,
      userId,
      role,
      timestamp: Date.now()
    });
  }
}

let gridFSBucket;

async function initMongoDB() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db("collabrecap");
    const roomsCollection = db.collection('archivedRooms');
    gridFSBucket = new GridFSBucket(db, {
      bucketName: 'recordings'
    });

    const recordingRouter = await initRecordingService(client);
    app.use('/api/recordings', recordingRouter);
    
    const testUploadRouter = await initTestUploadService(client);
    app.use('/api/test', testUploadRouter);
    
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
    
      socket.on('room:join', async ({ roomId, userId, role }) => {
        let room = activeRooms.get(roomId);
        
        if (!room) {
          try {
            const archivedRoom = await roomsCollection.findOne({ id: roomId });
            if (archivedRoom) {
              room = new Room(roomId);
              room.state = 'ARCHIVED';
              room.roles = archivedRoom.roles;
              room.startedAt = archivedRoom.startedAt;
              room.endedAt = archivedRoom.endedAt;
              room.codeOperations = archivedRoom.codeOperations;
              room.noteContent = archivedRoom.noteContent;
              room.noteLines = archivedRoom.noteLines;
              room.intervieweeNoteContent = archivedRoom.intervieweeNoteContent || '';
              room.intervieweeNoteLines = archivedRoom.intervieweeNoteLines || [];
              room.questionContent = archivedRoom.questionContent || '';
              activeRooms.set(roomId, room);
            } else {
              socket.emit('error', { 
                type: 'ROOM_ERROR',
                message: 'Room not found' 
              });
              return;
            }
          } catch (err) {
            console.error('Error accessing archived room:', err);
            socket.emit('error', { 
              type: 'ROOM_ERROR',
              message: 'Error accessing room' 
            });
            return;
          }
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
    
      socket.on('room:end', async ({ roomId, userId, operations, duration, endTime, questionContent }) => {
        const room = activeRooms.get(roomId);
        if (room && room.roles.interviewer === userId) {
          room.endedAt = endTime;
          
          const archived = room.archive(operations, questionContent);
          archived.duration = duration;
          
          try {
            await client.db("collabrecap").collection('archivedRooms').updateOne(
              { id: roomId },
              { 
                $set: { 
                  ...archived,
                  duration,
                  endTime,
                  questionContent
                } 
              },
              { upsert: true }
            );
            
            io.to(roomId).emit('room:ended', { endTime, duration });
          } catch (error) {
            console.error('Error archiving room:', error);
          }
        }
      });
    
      socket.on('note:add', ({ note, lineNumbers }) => {
        const { userId, roomId, role } = socket.data;
        const room = activeRooms.get(roomId);
        if (room) {
          console.log('Saving note:', { content: note, lines: lineNumbers });
          if (room.updateNote(note, lineNumbers)) {
            io.to(roomId).emit('note:sync', { content: note, lines: lineNumbers });
          }
        }
      });

      socket.on('interviewer:note:add', ({ note, lineNumbers }) => {
        const { userId, roomId, role } = socket.data;
        const room = activeRooms.get(roomId);
        if (room && role === 'interviewer') {
          console.log('Saving interviewer note:', { content: note, lines: lineNumbers });
          if (room.updateNote(note, lineNumbers)) {
          }
        }
      });

      socket.on('interviewee:note:add', ({ note, lineNumbers }) => {
        const { userId, roomId, role } = socket.data;
        const room = activeRooms.get(roomId);
        if (room && role === 'interviewee') {
          console.log('Saving interviewee note:', { content: note, lines: lineNumbers });
          
          room.intervieweeNoteContent = note;
          room.intervieweeNoteLines = lineNumbers;
          
          client.db("collabrecap").collection('archivedRooms').updateOne(
            { id: roomId },
            { $set: { 
              intervieweeNoteContent: note,
              intervieweeNoteLines: lineNumbers 
            } },
            { upsert: true }
          ).catch(err => console.error('Error updating interviewee notes:', err));
          
        }
      });

      socket.on('room:peer_id', ({ roomId, peerId }) => {
        if (!roomId || !peerId) return;
        
        socket.data.peerId = peerId;
        socket.to(roomId).emit('room:peer_id', { 
          peerId,
          userId: socket.data.userId 
        });
      });

      socket.on('room:peer_present', ({ roomId, peerId, role, userId }) => {
        if (!roomId || !peerId) return;
        
        console.log(`User ${userId} registered as ${role} with peer ID ${peerId} in room ${roomId}`);
        socket.data.peerId = peerId;
        
        socket.to(roomId).emit('room:peer_info', { 
          peerId,
          userId,
          role
        });
      });
      
      socket.on('room:get_peers', ({ roomId }) => {
        if (!roomId) return;
        
        console.log(`User ${socket.data.userId} requested peers in room ${roomId}`);
        
        const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
        if (!socketsInRoom) return;
        
        for (const socketId of socketsInRoom) {
          if (socketId !== socket.id) {
            const peerSocket = io.sockets.sockets.get(socketId);
            if (peerSocket && peerSocket.data.peerId) {
              socket.emit('room:peer_info', {
                peerId: peerSocket.data.peerId,
                userId: peerSocket.data.userId,
                role: peerSocket.data.role
              });
            }
          }
        }
      });

      socket.on('error', (error) => {
        console.log(error)
      })

      socket.on('webrtc:signal', ({ roomId, signal }) => {
        socket.to(roomId).emit('webrtc:signal', signal);
      });

      socket.on('video:ready', ({ roomId, role, ready }) => {
        socket.to(roomId).emit('video:ready', { role, ready });
      });
    
      socket.on('upload:status', async ({ roomId, role, status }) => {
        io.to(roomId).emit('upload:status', { role, status });
        
        const room = activeRooms.get(roomId);
        if (room) {
          room.uploadStatus[role] = status === 'complete';
        }

        try {
          await client.db("collabrecap").collection('archivedRooms').updateOne(
            { id: roomId },
            { $set: { [`uploadStatus.${role}`]: status === 'complete' } }
          );
        } catch (error) {
          console.error('Error updating upload status:', error);
        }
      });

      socket.on('room:update_operations', async ({ roomId, operations }) => {
        const room = activeRooms.get(roomId);
        if (room && room.state === 'ARCHIVED') {
          room.codeOperations = operations;
          
          try {
            await client.db("collabrecap").collection('archivedRooms').updateOne(
              { id: roomId },
              { $set: { codeOperations: operations } }
            );
            console.log(`Updated operations for room ${roomId}`);
          } catch (error) {
            console.error('Error updating operations:', error);
          }
        }
      });

      socket.on('room:update_interviewee_notes', async ({ roomId, noteContent, noteLines, userId }) => {
        const room = activeRooms.get(roomId);
        if (room && room.state === 'ARCHIVED') {
          room.intervieweeNoteContent = noteContent;
          room.intervieweeNoteLines = noteLines;
          
          try {
            await client.db("collabrecap").collection('archivedRooms').updateOne(
              { id: roomId },
              { $set: { 
                intervieweeNoteContent: noteContent,
                intervieweeNoteLines: noteLines 
              } }
            );
            console.log(`Updated interviewee notes for room ${roomId}`);
          } catch (error) {
            console.error('Error updating interviewee notes:', error);
          }
        }
      });

      socket.on('video:mute:sync', ({ roomId, isMuted, userId }) => {
        console.log(`User ${userId} sharing mute state in room ${roomId}:`, { isMuted });
        
        socket.to(roomId).emit('video:mute:receive', {
          roomId,
          isMuted,
          userId,
          fromUser: socket.data.role
        });
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
                  noteLines: archived.noteLines
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

    return client;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

wss.on('error', (error) => {
  console.error('WebSocket Server Error:', error);
});

app.get('/api/activeRooms/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    console.log('Fetching rooms for user:', userId);

    if (!client.topology?.isConnected()) {
      console.log('MongoDB not connected, attempting to connect...');
      await client.connect();
    }

    const userRooms = {
      interviewer: [],
      interviewee: []
    };

    console.log('Active rooms count:', activeRooms.size);
    for (const room of activeRooms.values()) {
      if (room.roles.interviewer === userId) {
        userRooms.interviewer.push(room.serialize());
      }
      if (room.roles.interviewee === userId) {
        userRooms.interviewee.push(room.serialize());
      }
    }

    const db = client.db("collabrecap");
    const archivedRooms = await db.collection('archivedRooms')
      .find({
        $or: [
          { "roles.interviewer": userId },
          { "roles.interviewee": userId }
        ]
      })
      .sort({ createdAt: -1 })
      .toArray();

    console.log('Found archived rooms:', archivedRooms.length);

    archivedRooms.forEach(room => {
      if (room.roles.interviewer === userId) {
        userRooms.interviewer.push(room);
      }
      if (room.roles.interviewee === userId) {
        userRooms.interviewee.push(room);
      }
    });
    
    console.log('Total rooms found:', {
      interviewer: userRooms.interviewer.length,
      interviewee: userRooms.interviewee.length
    });

    res.json(userRooms);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ 
      error: 'Failed to fetch rooms',
      details: error.message,
      stack: error.stack
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  try {
    await initMongoDB();
    console.log('Server fully initialized');
  } catch (error) {
    console.error('Server initialization error:', error);
    process.exit(1);
  }
});
