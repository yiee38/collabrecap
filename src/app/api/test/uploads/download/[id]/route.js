import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export async function GET(request, { params }) {
  const { id } = params;
  
  try {
    const response = await fetch(`${API_URL}/api/test/uploads/download/${id}`, {
      headers: {
        'Accept': '*/*',
      }
    });
    
    if (!response.ok) {
      console.error(`Failed to download video: HTTP ${response.status}`);
      return NextResponse.json(
        { error: 'Failed to download test video' },
        { status: response.status }
      );
    }
    
    const headers = new Headers();
    
    const headersToForward = [
      'content-type',
      'content-length',
      'last-modified'
    ];
    
    for (const header of headersToForward) {
      if (response.headers.has(header)) {
        headers.set(header, response.headers.get(header));
      }
    }
    
    if (!headers.has('content-type')) {
      headers.set('content-type', 'video/webm');
    }
    
    headers.set('Content-Disposition', `attachment; filename="video-${id}.webm"`);
    
    headers.set('Cache-Control', 'no-store');
    
    return new Response(response.body, {
      status: 200,
      headers
    });
  } catch (error) {
    console.error('Error downloading test file:', error);
    return NextResponse.json(
      { error: 'Server error downloading video file: ' + error.message },
      { status: 500 }
    );
  }
} 