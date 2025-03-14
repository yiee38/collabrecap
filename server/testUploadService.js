const express = require('express');
const { ObjectId, GridFSBucket } = require('mongodb');
const cors = require('cors');
const multer = require('multer');
const { Readable } = require('stream');

const router = express.Router();
router.use(cors({
  origin: process.env.NEXT_PUBLIC_CLIENT_URL || "http://localhost:3000",
  methods: ['GET', 'POST']
}));

const upload = multer({ storage: multer.memoryStorage() });

let testGridFSBucket;

async function initTestUploadService(mongoClient) {
  try {
    const db = mongoClient.db("collabrecap");
    
    testGridFSBucket = new GridFSBucket(db, {
      bucketName: 'test_uploads',
      chunkSizeBytes: 5 * 1024 * 1024
    });
    
    console.log('Test upload service initialized with MongoDB (optimized for desktop video streaming)');
    return router;
  } catch (error) {
    console.error('Failed to initialize test upload service:', error);
    throw error;
  }
}

router.post('/uploads', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const testId = req.body.testId || `test-${Date.now()}`;
    const timestamp = Date.now();
    const filename = `test-${testId}-${timestamp}.webm`;
    
    console.log(`Handling test upload: ${filename} (${req.file.size} bytes)`);
    
    const readableStream = new Readable();
    readableStream.push(req.file.buffer);
    readableStream.push(null);

    const uploadStream = testGridFSBucket.openUploadStream(filename, {
      contentType: req.file.mimetype || 'video/webm',
      metadata: {
        testId,
        timestamp,
        originalName: req.file.originalname
      }
    });

    readableStream.pipe(uploadStream);

    uploadStream.on('finish', () => {
      console.log('Test upload complete:', {
        id: uploadStream.id.toString(),
        filename,
        size: uploadStream.length
      });
      
      res.json({
        id: uploadStream.id.toString(),
        filename,
        size: uploadStream.length,
        timestamp
      });
    });

    uploadStream.on('error', (error) => {
      console.error('Test upload error:', error);
      res.status(500).json({ error: 'Upload failed' });
    });
  } catch (error) {
    console.error('Error handling test upload:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

router.get('/uploads/list', async (req, res) => {
  try {
    const files = await testGridFSBucket.find({}).toArray();
    
    res.json({
      files: files.map(file => ({
        id: file._id.toString(),
        filename: file.filename,
        size: file.length,
        contentType: file.contentType,
        uploadDate: file.uploadDate,
        metadata: file.metadata
      }))
    });
  } catch (error) {
    console.error('Error listing test files:', error);
    res.status(500).json({ error: 'Failed to list test files' });
  }
});

router.get('/uploads/stream/:id', async (req, res) => {
  try {
    const fileId = new ObjectId(req.params.id);
    const files = await testGridFSBucket.find({ _id: fileId }).toArray();
    
    if (!files.length) {
      return res.status(404).json({ error: 'Test file not found' });
    }

    const fileInfo = files[0];
    const fileSize = fileInfo.length;
    
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': fileInfo.contentType || 'video/webm',
      'Accept-Ranges': 'bytes'
    });
    
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const requestedEnd = parts[1] ? parseInt(parts[1], 10) : undefined;
      
      const defaultChunkSize = 2 * 1024 * 1024;
      const maxChunkSize = 5 * 1024 * 1024;
      
      let end;
      if (requestedEnd && !isNaN(requestedEnd) && requestedEnd < fileSize) {
        end = requestedEnd;
      } else {
        end = Math.min(start + defaultChunkSize, fileSize - 1);
        
        if (start === 0) {
          end = Math.min(start + maxChunkSize, fileSize - 1);
        }
      }
      
      const chunkSize = (end - start) + 1;
      
      console.log(`Streaming test file range ${start}-${end}/${fileSize} for:`, {
        id: fileInfo._id.toString(),
        filename: fileInfo.filename,
        chunkSize: `${Math.round(chunkSize/1024)}KB`
      });
      
      res.status(206);
      res.set({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': chunkSize,
        'Cache-Control': 'public, max-age=3600'
      });
      
      const downloadStream = testGridFSBucket.openDownloadStream(fileId, {
        start: start,
        end: end + 1
      });
      
      downloadStream.on('error', (error) => {
        console.error('Test streaming error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Streaming failed' });
        }
      });
      
      downloadStream.pipe(res);
    } else {
      console.log(`Streaming complete test file:`, {
        id: fileInfo._id.toString(),
        filename: fileInfo.filename,
        size: fileSize
      });
      
      res.set({
        'Content-Length': fileSize,
        'Content-Disposition': `inline; filename="${fileInfo.filename}"`,
        'Cache-Control': 'public, max-age=3600'
      });
      
      const downloadStream = testGridFSBucket.openDownloadStream(fileId);
      downloadStream.pipe(res);
      
      downloadStream.on('error', (error) => {
        console.error('Test streaming error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Streaming failed' });
        }
      });
    }
  } catch (error) {
    console.error('Error streaming test file:', error);
    res.status(500).json({ error: 'Streaming failed' });
  }
});

router.delete('/uploads/:id', async (req, res) => {
  try {
    const fileId = new ObjectId(req.params.id);
    await testGridFSBucket.delete(fileId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting test file:', error);
    res.status(500).json({ error: 'Failed to delete test file' });
  }
});

module.exports = {
  initTestUploadService
}; 