import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

async function fetchFromServer(path, options = {}) {
  const url = `${API_URL}/api/recordings${path}`;
  const res = await fetch(url, options);
  if (!res.ok && res.status !== 206) throw new Error('Server request failed');
  return res;
}

export async function GET(request) {
  const path = request.nextUrl.pathname.replace('/api/recordings', '');
  
  try {
    const options = {};
    const rangeHeader = request.headers.get('range');
    
    if (rangeHeader && path.includes('/stream/')) {
      options.headers = {
        'Range': rangeHeader
      };
    }
    
    const res = await fetchFromServer(path, options);

    if (path.includes('/stream/')) {
      const video = await res.blob();
      const headers = new Headers({
        'Content-Type': 'video/webm',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      });
      
      if (res.headers.has('content-length')) {
        headers.set('Content-Length', res.headers.get('content-length'));
      }
      
      if (res.headers.has('content-range')) {
        headers.set('Content-Range', res.headers.get('content-range'));
      }
      
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Accept-Ranges', 'bytes');
      
      return new Response(video, {
        status: res.status,
        headers
      });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('API Error:', err);
    return NextResponse.json(
      { message: 'Could not load content' }, 
      { status: 500 }
    );
  }
}

export async function POST(request) {
  const path = request.nextUrl.pathname.replace('/api/recordings', '');

  try {
    const form = await request.formData();
    const res = await fetchFromServer(path, {
      method: 'POST',
      body: form
    });
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('Upload failed:', err);
    return NextResponse.json(
      { message: 'Could not save recording' }, 
      { status: 500 }
    );
  }
}
