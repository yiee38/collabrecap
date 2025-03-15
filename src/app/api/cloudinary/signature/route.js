import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

export async function POST(request) {
  try {
    if (process.env.CLOUDINARY_URL) {
      console.log('Found CLOUDINARY_URL format, using it for configuration');
      
      try {
        cloudinary.config({ 
          url: process.env.CLOUDINARY_URL 
        });
        
        console.log('Configured Cloudinary using URL string, cloud name:', cloudinary.config().cloud_name);
      } catch (configError) {
        console.error('Error parsing CLOUDINARY_URL:', configError);
        return NextResponse.json(
          { error: 'Failed to parse CLOUDINARY_URL', message: configError.message },
          { status: 500 }
        );
      }
    } 
    else if (process.env.CLOUDINARY_CLOUD_NAME && 
        process.env.CLOUDINARY_API_KEY && 
        process.env.CLOUDINARY_API_SECRET) {
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME.trim();
      const apiKey = process.env.CLOUDINARY_API_KEY.trim();
      const apiSecret = process.env.CLOUDINARY_API_SECRET.trim();

      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret
      });

      console.log('Configured Cloudinary with individual credentials');
    } else {
      console.error('Missing Cloudinary credentials in environment variables');
      return NextResponse.json(
        { 
          error: 'Server configuration error: Missing Cloudinary credentials',
          missing: {
            cloudinary_url: !process.env.CLOUDINARY_URL,
            cloud_name: !process.env.CLOUDINARY_CLOUD_NAME,
            api_key: !process.env.CLOUDINARY_API_KEY,
            api_secret: !process.env.CLOUDINARY_API_SECRET
          }
        },
        { status: 500 }
      );
    }

    if (!cloudinary.config().cloud_name || 
        !cloudinary.config().api_key || 
        !cloudinary.config().api_secret) {
      console.error('Cloudinary configuration incomplete after setup');
      return NextResponse.json(
        { error: 'Cloudinary configuration incomplete' },
        { status: 500 }
      );
    }

    console.log('Cloudinary configured with:', {
      cloud_name: cloudinary.config().cloud_name,
      api_key_length: cloudinary.config().api_key?.length || 0,
      api_secret_length: cloudinary.config().api_secret?.length || 0
    });

    const body = await request.json();
    const { roomId, userId, role, isFinal } = body;
    
    const timestamp = Math.round(new Date().getTime() / 1000);

    const safeUserId = userId.replace(/@/g, '_at_').replace(/\./g, '_dot_');
    
    const filename = isFinal === true 
      ? `recording-${roomId}-${safeUserId}-${role}-${timestamp}` 
      : `chunk-${roomId}-${safeUserId}-${role}-${timestamp}`;
    
    const folder = `interview-recordings/${roomId}`;
    
    const contextData = {
      roomId: roomId,
      userId: safeUserId,
      role: role,
      isFinal: isFinal.toString()
    };
    const contextValue = Object.entries(contextData)
      .map(([key, value]) => `${key}=${value}`)
      .join('|');
    
    console.log('Context value:', contextValue);
    
    const paramsToSign = {
      context: contextValue,
      folder: folder,
      public_id: filename,
      resource_type: 'video',
      timestamp: timestamp,
      upload_preset: "collabrecap"
    };
    
    try {
      console.log('Attempting to generate signature with params:', JSON.stringify(paramsToSign, null, 2));
      
      console.log('Cloudinary config check:', {
        cloud_name_set: !!cloudinary.config().cloud_name,
        api_key_set: !!cloudinary.config().api_key,
        api_secret_set: !!cloudinary.config().api_secret,
      });
      
      const signature = cloudinary.utils.api_sign_request(
        paramsToSign, 
        cloudinary.config().api_secret
      );
      
      console.log("String used for signature:", cloudinary.utils.api_sign_request.getStringToSign(paramsToSign));
      console.log("Generated signature:", signature);
      
      return NextResponse.json({
        signature,
        timestamp,
        uploadPreset: "collabrecap",
        cloudName: cloudinary.config().cloud_name,
        apiKey: cloudinary.config().api_key,
        folder,
        publicId: filename,
        context: contextValue
      });
    } catch (signError) {
      console.error('Error generating Cloudinary signature:', signError);
      console.error('Error details:', {
        message: signError.message,
        stack: signError.stack,
        cloudinaryConfig: {
          cloud_name_set: !!cloudinary.config().cloud_name,
          api_key_set: !!cloudinary.config().api_key,
          api_secret_set: !!cloudinary.config().api_secret
        },
        paramsToSign
      });
      
      return NextResponse.json(
        { 
          error: 'Failed to generate signature', 
          message: signError.message,
          details: process.env.NODE_ENV === 'development' ? signError.stack : undefined
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('General error in signature endpoint:', error);
    return NextResponse.json(
      { 
        error: 'Server error', 
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
} 