const express = require('express');
const {  ObjectId, GridFSBucket } = require('mongodb');
const cors = require('cors');
const multer = require('multer');
const { Readable } = require('stream');

const router = express.Router();
router.use(cors({
  origin: process.env.NEXT_PUBLIC_CLIENT_URL || "http://localhost:3000",
  methods: ['GET', 'POST']
}));

const upload = multer({ storage: multer.memoryStorage() });

let gridFSBucket;

async function initRecordingService(mongoClient) {
  try {
    const db = mongoClient.db("collabrecap");
    gridFSBucket = new GridFSBucket(db, {
      bucketName: 'recordings'
    });
    console.log('Recording service initialized with existing MongoDB connection');
    return router;
  } catch (error) {
    console.error('Failed to initialize recording service:', error);
    throw error;
  }
}

const activeRecordings = new Map();

router.post('/rooms/:roomId/upload', upload.single('recording'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { roomId } = req.params;
    const { userId, role, isFinal } = req.body;
    const timestamp = Date.now();
    const sessionKey = `${roomId}-${userId}`;

    if (isFinal !== 'true') {
      const chunkFilename = `chunk-${sessionKey}-${timestamp}.webm`;
      const readableStream = new Readable();
      readableStream.push(req.file.buffer);
      readableStream.push(null);

      const uploadStream = gridFSBucket.openUploadStream(chunkFilename, {
        contentType: 'video/webm',
        metadata: {
          roomId,
          userId,
          role,
          timestamp,
          isChunk: true
        }
      });

      readableStream.pipe(uploadStream);

      uploadStream.on('finish', () => {
        console.log('Chunk uploaded:', {
          id: uploadStream.id.toString(),
          filename: chunkFilename,
          size: uploadStream.length
        });
        res.json({ 
          status: 'chunk_received',
          chunkId: uploadStream.id.toString()
        });
      });
    } else {
      
      const filename = `recording-${roomId}-${userId}-${timestamp}.webm`;
      const readableStream = new Readable();
      readableStream.push(req.file.buffer);
      readableStream.push(null);

      const uploadStream = gridFSBucket.openUploadStream(filename, {
        contentType: 'video/webm',
        metadata: {
          roomId,
          userId,
          role,
          timestamp,
          isFinal: true
        }
      });

      readableStream.pipe(uploadStream);

      uploadStream.on('finish', () => {
        console.log('Final recording uploaded:', {
          id: uploadStream.id.toString(),
          filename,
          size: uploadStream.length
        });
        
        gridFSBucket.find({ 
          'metadata.roomId': roomId,
          'metadata.userId': userId,
          'metadata.isChunk': true 
        }).toArray().then(chunks => {
          chunks.forEach(chunk => {
            gridFSBucket.delete(chunk._id);
          });
        });

        res.json({ 
          recordingId: uploadStream.id.toString(),
          filename,
          timestamp
        });
      });
    }

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

router.get('/stream/:recordingId', async (req, res) => {
  try {
    const recordingId = new ObjectId(req.params.recordingId);
    const files = await gridFSBucket.find({ _id: recordingId }).toArray();
    
    if (!files.length) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    const fileInfo = files[0];
    console.log('Streaming file:', {
      id: fileInfo._id.toString(),
      filename: fileInfo.filename,
      size: fileInfo.length,
      contentType: fileInfo.metadata?.contentType
    });

    res.set({
      'Content-Type': 'video/webm',
      'Content-Length': fileInfo.length,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    });

    const chunks = [];
    const downloadStream = gridFSBucket.openDownloadStream(recordingId);
    
    downloadStream.on('data', chunk => {
      chunks.push(chunk);
    });

    downloadStream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      res.end(buffer);
    });

    downloadStream.on('error', (error) => {
      console.error('Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Streaming failed' });
      }
    });

  } catch (error) {
    console.error('Stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Streaming failed' });
    }
  }
});

router.get('/rooms/:roomId/list', async (req, res) => {
  try {
    const { roomId } = req.params;
    const cursor = gridFSBucket.find({ 
      'metadata.roomId': roomId,
      'metadata.isChunk': { $ne: true } 
    });
    const files = await cursor.toArray();
    
    res.json({
      recordings: files.map(file => ({
        id: file._id.toString(),
        filename: file.filename,
        userId: file.metadata?.userId,
        role: file.metadata?.role,
        timestamp: file.metadata?.timestamp,
        size: file.length
      }))
    });
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ error: 'Failed to list recordings' });
  }
});


module.exports = { initRecordingService };
