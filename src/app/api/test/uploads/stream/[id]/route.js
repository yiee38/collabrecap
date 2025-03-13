import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export async function GET(request, { params }) {
  const { id } = params;
  
  try {
    const options = {};
    const rangeHeader = request.headers.get('range');
    
    if (rangeHeader) {
      options.headers = {
        'Range': rangeHeader
      };
    }
    
    console.log(`Streaming test video ${id} with range:`, rangeHeader || 'none');
    
    const res = await fetch(`${API_URL}/api/test/uploads/stream/${id}`, options);
    
    if (!res.ok && res.status !== 206) {
      return NextResponse.json(
        { error: 'Failed to stream test file' },
        { status: res.status }
      );
    }
    
    const video = await res.blob();
    const headers = new Headers({
      'Content-Type': 'video/webm',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*'
    });
    
    if (res.headers.has('content-length')) {
      headers.set('Content-Length', res.headers.get('content-length'));
    }
    
    if (res.headers.has('content-range')) {
      headers.set('Content-Range', res.headers.get('content-range'));
    }
    
    return new Response(video, {
      status: res.status,
      headers
    });
  } catch (error) {
    console.error('Error streaming test file:', error);
    return NextResponse.json(
      { error: 'Server error streaming test file' },
      { status: 500 }
    );
  }
} 