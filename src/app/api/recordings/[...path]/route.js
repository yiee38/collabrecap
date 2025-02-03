import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

async function fetchFromServer(path, options = {}) {
  const url = `${API_URL}/api/recordings${path}`;
  const res = await fetch(url, options);
  if (!res.ok) throw new Error('Server request failed');
  return res;
}

export async function GET(request) {
  const path = request.nextUrl.pathname.replace('/api/recordings', '');
  
  try {
    const res = await fetchFromServer(path);

    if (path.includes('/stream/')) {
      const video = await res.blob();
      return new Response(video, {
        headers: {
          'Content-Type': 'video/webm',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
          ...(res.headers.has('content-length') && {
            'Content-Length': res.headers.get('content-length')
          })
        }
      });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.log('API Error:', err);
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
    console.log('Upload failed:', err);
    return NextResponse.json(
      { message: 'Could not save recording' }, 
      { status: 500 }
    );
  }
}
