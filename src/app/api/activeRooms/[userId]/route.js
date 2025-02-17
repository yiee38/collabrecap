import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  try {
    const { userId } = params;
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    const serverUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    const url = `${serverUrl}/api/activeRooms/${userId}`;
    console.log('Fetching rooms from:', url);

    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Server response error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });
      return NextResponse.json({ 
        error: `Server error: ${response.status} ${response.statusText}`,
        details: errorText
      }, { status: response.status });
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch rooms:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch rooms',
      details: error.message
    }, { status: 500 });
  }
} 