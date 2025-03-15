import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export async function GET(request) {
  try {
    const result = await cloudinary.api.ping();
    
    const usage = await cloudinary.api.usage();
    
    return NextResponse.json({
      status: 'success',
      credentials: {
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key_partial: process.env.CLOUDINARY_API_KEY?.substring(0, 5) + '...',
        api_secret_check: process.env.CLOUDINARY_API_SECRET ? 'present' : 'missing'
      },
      ping: result,
      usage
    });
  } catch (error) {
    console.error('Error checking Cloudinary credentials:', error);
    return NextResponse.json(
      { 
        status: 'error', 
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
} 