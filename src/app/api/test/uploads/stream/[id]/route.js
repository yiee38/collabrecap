import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export async function GET(request, { params }) {
  const { id } = params;
  
  try {
    const options = { 
      headers: {
        'Accept': '*/*',
      }
    };
    const rangeHeader = request.headers.get('range');
    
    if (rangeHeader) {
      options.headers['Range'] = rangeHeader;
      console.log(`Streaming video with range request: ${rangeHeader}`);
    }
    
    const response = await fetch(`${API_URL}/api/test/uploads/stream/${id}`, options);
    
    if (!response.ok && response.status !== 206) {
      console.error(`Failed to stream video: HTTP ${response.status}`);
      return NextResponse.json(
        { error: 'Failed to stream test video' },
        { status: response.status }
      );
    }
    
    const video = await response.blob();
    
    const headers = new Headers();
    
    const headersToForward = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified',
      'etag'
    ];
    
    for (const header of headersToForward) {
      if (response.headers.has(header)) {
        headers.set(header, response.headers.get(header));
      }
    }
    
    if (!headers.has('content-type')) {
      headers.set('content-type', 'video/mp4');
    }
    
    headers.set('accept-ranges', 'bytes');
    
    headers.set('access-control-allow-origin', '*');
    headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
    headers.set('access-control-allow-headers', 'Range, Content-Type, Accept, Content-Range');
    
    headers.set('cache-control', 'public, max-age=300');
    
    if (rangeHeader && !headers.has('content-range') && headers.has('content-length')) {
      const totalSize = parseInt(headers.get('content-length'), 10);
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      
      headers.set('content-range', `bytes ${start}-${end}/${totalSize}`);
      headers.set('content-length', String(end - start + 1));
    }
    
    return new Response(video, {
      status: rangeHeader ? 206 : 200,
      headers
    });
  } catch (error) {
    console.error('Error streaming test file:', error);
    return NextResponse.json(
      { error: 'Server error streaming video file: ' + error.message },
      { status: 500 }
    );
  }
} 