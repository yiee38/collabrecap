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
      'Content-Type': res.headers.get('content-type') || 'video/webm',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=60', 
      'Transfer-Encoding': 'chunked',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Content-Range, X-Requested-With'
    });
    
    if (res.headers.has('content-length')) {
      headers.set('Content-Length', res.headers.get('content-length'));
    }
    
    if (res.headers.has('content-range')) {
      headers.set('Content-Range', res.headers.get('content-range'));
    }
    
    if (rangeHeader && !res.headers.has('content-range') && res.headers.has('content-length')) {
      const totalSize = parseInt(res.headers.get('content-length'));
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      
      headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      headers.set('Content-Length', String(end - start + 1));
    }
    
    return new Response(video, {
      status: rangeHeader ? 206 : 200,
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