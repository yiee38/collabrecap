import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ 
    url: process.env.CLOUDINARY_URL 
  });
  console.log('Server Upload API: Configured Cloudinary using URL string');
} else if (process.env.CLOUDINARY_CLOUD_NAME && 
    process.env.CLOUDINARY_API_KEY && 
    process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
    api_key: process.env.CLOUDINARY_API_KEY.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET.trim()
  });
  console.log('Server Upload API: Configured Cloudinary with individual credentials');
} else {
  console.error('Server Upload API: Missing Cloudinary credentials in environment variables');
}

export async function POST(request) {
  try {
    if (!cloudinary.config().cloud_name || 
        !cloudinary.config().api_key || 
        !cloudinary.config().api_secret) {
      console.error('Server Upload API: Cloudinary not configured properly');
      console.error('Available config:', {
        cloud_name: cloudinary.config().cloud_name || 'missing',
        api_key: cloudinary.config().api_key ? 'present (length: ' + cloudinary.config().api_key.length + ')' : 'missing',
        api_secret: cloudinary.config().api_secret ? 'present (length: ' + cloudinary.config().api_secret.length + ')' : 'missing'
      });
      return NextResponse.json(
        { error: 'Cloudinary not configured' },
        { status: 500 }
      );
    }
    
    const formData = await request.formData();
    
    const file = formData.get('file');
    if (!file) {
      console.error('Server Upload API: No file provided in request');
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }
    
    if (file.size < 1024) {
      console.error(`Server Upload API: File too small (${file.size} bytes)`);
      return NextResponse.json(
        { error: 'File too small to be a valid recording' },
        { status: 400 }
      );
    }
    
    if (file.size > 100 * 1024 * 1024) {
      console.error(`Server Upload API: File too large (${Math.round(file.size/1024/1024)}MB)`);
      return NextResponse.json(
        { error: 'File too large (max 100MB)' },
        { status: 400 }
      );
    }
    
    const roomId = formData.get('roomId') || 'unknown';
    const userId = formData.get('userId') || 'anonymous';
    const role = formData.get('role') || 'user';
    const isFinal = formData.get('isFinal') === 'true';
    
    console.log('Server Upload API: Received file:', {
      name: file.name || 'unnamed',
      type: file.type || 'unknown',
      size: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
      isFinal
    });
    
    const safeUserId = userId.replace(/[^a-zA-Z0-9]/g, '_');
    const folderPath = `interview-recordings/${roomId}`;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${isFinal ? 'final' : 'partial'}-${role}-${timestamp}`;
    
    if (!isFinal) {
      console.log('Server Upload API: Non-final upload, acknowledging receipt');
      return NextResponse.json({
        success: true,
        intermediate: true,
        message: 'Intermediate upload acknowledged'
      });
    }
    
    const buffer = Buffer.from(await file.arrayBuffer());
    console.log(`Server Upload API: Processing ${buffer.length} bytes for Cloudinary upload`);
    
    try {
      console.log(`Server Upload API: Uploading to Cloudinary (folder: ${folderPath}, filename: ${filename})`);
      
      const uploadParams = {
        folder: folderPath,
        public_id: filename,
        resource_type: 'video',
        upload_preset: "collabrecap",
        display_name: `${role}_recording_${roomId}`
      };
      
      uploadParams.context = `roomId=${roomId}|userId=${safeUserId}|role=${role}|isFinal=true`;
      
      console.log('Server Upload API: Upload params:', {
        ...uploadParams,
        context: uploadParams.context
      });
      
      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          uploadParams,
          (error, result) => {
            if (error) {
              console.error('Server Upload API: Upload error:', error);
              reject(error);
            } else {
              resolve(result);
            }
          }
        );
        
        uploadStream.on('error', (err) => {
          console.error('Server Upload API: Stream error:', err);
          reject(err);
        });
        
        uploadStream.write(buffer);
        uploadStream.end();
      });
      
      console.log('Server Upload API: Upload successful:', {
        publicId: uploadResult.public_id,
        url: uploadResult.secure_url,
        size: `${(uploadResult.bytes / 1024 / 1024).toFixed(2)}MB`,
        format: uploadResult.format
      });
      
      return NextResponse.json({
        success: true,
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        format: uploadResult.format,
        bytes: uploadResult.bytes,
        displayName: uploadResult.display_name || filename
      });
      
    } catch (uploadError) {
      console.error('Server Upload API: Upload failed:', uploadError);
      
      let errorMessage = 'Upload failed';
      let errorDetails = uploadError.message || 'Unknown error';
      
      if (uploadError.message && uploadError.message.includes('format')) {
        errorMessage = 'Unsupported video format';
        errorDetails = 'Please check that the recording is in a valid format (e.g., WebM, MP4)';
      } else if (uploadError.message && uploadError.message.includes('bandwidth') || 
                 uploadError.message && uploadError.message.includes('timeout')) {
        errorMessage = 'Upload timeout';
        errorDetails = 'Connection issue or file too large for current bandwidth';
      }
      
      return NextResponse.json(
        { 
          error: errorMessage, 
          message: errorDetails,
          details: uploadError.stack || 'No stack trace available'
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Server Upload API: Unhandled error:', error);
    return NextResponse.json(
      { 
        error: 'Server error', 
        message: error.message || 'An unexpected error occurred',
        details: error.stack || 'No stack trace available'
      },
      { status: 500 }
    );
  }
} 