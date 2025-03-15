import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ 
    url: process.env.CLOUDINARY_URL 
  });
  console.log('Recordings API: Configured Cloudinary using URL string');
} else if (process.env.CLOUDINARY_CLOUD_NAME && 
    process.env.CLOUDINARY_API_KEY && 
    process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
    api_key: process.env.CLOUDINARY_API_KEY.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET.trim()
  });
  console.log('Recordings API: Configured Cloudinary with individual credentials');
} else {
  console.error('Recordings API: Missing Cloudinary credentials in environment variables');
}

export async function GET(request) {
  try {
    console.log('Recordings API: Checking Cloudinary configuration:', {
      cloudName: cloudinary.config().cloud_name || 'missing',
      apiKey: cloudinary.config().api_key ? 'present' : 'missing',
      apiSecret: cloudinary.config().api_secret ? 'present' : 'missing'
    });
    
    if (!cloudinary.config().cloud_name || 
        !cloudinary.config().api_key || 
        !cloudinary.config().api_secret) {
      console.error('Recordings API: Cloudinary configuration incomplete');
      return NextResponse.json(
        { error: 'Server configuration error: Missing Cloudinary credentials' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');
    
    if (!roomId) {
      console.log('Recordings API: Missing roomId parameter');
      return NextResponse.json(
        { error: 'Room ID is required' },
        { status: 400 }
      );
    }
    
    console.log(`Recordings API: Searching for recordings for room ID: ${roomId}`);
    
    try {
      const folderPath = `interview-recordings/${roomId}`;
      
      console.log(`Recordings API: Getting videos from folder: ${folderPath}`);
      
      try {
        const result = await cloudinary.api.resources({
          type: 'upload',
          prefix: folderPath,
          resource_type: 'video',
          max_results: 20
        });
        
        console.log(`Recordings API: Found ${result.resources?.length || 0} resources via listing`);
        
        if (result.resources && result.resources.length > 0) {
          const videoDetailsPromises = result.resources.map(resource => 
            cloudinary.api.resource(resource.public_id, { 
              resource_type: 'video',
              context: true,
              metadata: true
            })
          );
          
          const videoDetails = await Promise.all(videoDetailsPromises);
          console.log(`Recordings API: Retrieved details for ${videoDetails.length} videos`);
          
          const finalRecordings = videoDetails.filter(resource => {
            const publicId = resource.public_id;
            const filename = publicId.split('/').pop();
            const isFinalByName = filename.startsWith('final-');
            
            const contextData = resource.context?.custom || {};
            const isFinalByContext = contextData.isFinal === 'true';
            
            return isFinalByName || isFinalByContext;
          });
          
          console.log(`Recordings API: Filtered to ${finalRecordings.length} final recordings`);
          
          const recordings = finalRecordings.map(resource => {
            let role = 'unknown';
            
            const filename = resource.public_id.split('/').pop();
            const filenameParts = filename.split('-');
            if (filenameParts.length >= 2) {
              role = filenameParts[1];
            }
            
            const contextData = resource.context?.custom || {};
            if (role === 'unknown' && contextData.role) {
              role = contextData.role;
            }
            
            const displayName = resource.display_name || contextData.display_name ||
                               `${role}_recording_${roomId}`;
            
            const userId = contextData.userId || 'unknown';
            
            return {
              id: resource.public_id,
              url: resource.secure_url,
              filename: displayName,
              userId: userId,
              role: role,
              timestamp: resource.created_at,
              size: resource.bytes,
              format: resource.format,
              duration: resource.duration
            };
          });
          
          recordings.forEach(rec => {
            console.log(`Recordings API: Found recording - ID: ${rec.id}, Role: ${rec.role}, Size: ${Math.round(rec.size/1024)}KB`);
          });
          
          return NextResponse.json({ recordings });
        }
      } catch (listError) {
        console.error('Recordings API: Error listing resources:', listError);
      }
      
      console.log('Recordings API: Falling back to search...');
      const searchExpression = `resource_type:video AND folder:${folderPath}`;
      
      console.log(`Recordings API: Using search expression: "${searchExpression}"`);
      
      const searchResult = await cloudinary.search
        .expression(searchExpression)
        .with_field('context')
        .sort_by('created_at', 'desc')
        .max_results(20)
        .execute();
      
      console.log(`Recordings API: Search returned ${searchResult.resources?.length || 0} resources`);
      
      const finalRecordings = (searchResult.resources || []).filter(resource => {
        const filename = resource.public_id.split('/').pop();
        const isFinalByName = filename.startsWith('final-');
        
        const contextData = resource.context?.custom || {};
        const isFinalByContext = contextData.isFinal === 'true';
        
        return isFinalByName || isFinalByContext;
      });
      
      console.log(`Recordings API: Filtered to ${finalRecordings.length} final recordings`);
      
      const recordings = finalRecordings.map(resource => {
        let role = 'unknown';
        
        const filename = resource.public_id.split('/').pop();
        const filenameParts = filename.split('-');
        if (filenameParts.length >= 2) {
          role = filenameParts[1]; 
        }
        
        const contextData = resource.context?.custom || {};
        if (role === 'unknown' && contextData.role) {
          role = contextData.role;
        }
        
        const displayName = resource.display_name || contextData.display_name ||
                           `${role}_recording_${roomId}`;
        
        const userId = contextData.userId || 'unknown';
        
        return {
          id: resource.public_id,
          url: resource.secure_url,
          filename: displayName,
          userId: userId,
          role: role,
          timestamp: resource.created_at,
          size: resource.bytes,
          format: resource.format,
          duration: resource.duration
        };
      });
      
      recordings.forEach(rec => {
        console.log(`Recordings API: Found recording - ID: ${rec.id}, Role: ${rec.role}, Size: ${Math.round(rec.size/1024)}KB`);
      });
      
      return NextResponse.json({ recordings });
    } catch (searchError) {
      console.error('Recordings API: Error searching Cloudinary:', searchError);
      return NextResponse.json(
        { 
          error: 'Failed to search recordings', 
          message: searchError.message || 'Unknown Cloudinary search error',
          details: searchError.stack || 'No stack trace available'
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Recordings API: General error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch recordings', 
        message: error.message || 'Unknown server error',
        details: error.stack || 'No stack trace available' 
      },
      { status: 500 }
    );
  }
} 