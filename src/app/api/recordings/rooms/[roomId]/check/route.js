import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export async function GET(request, { params }) {
  const { roomId } = params;
  
  try {
    const url = `${API_URL}/api/recordings/rooms/${roomId}/check`;
    const res = await fetch(url);
    
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to check room recordings' }, 
        { status: res.status }
      );
    }
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('API Error:', err);
    return NextResponse.json(
      { error: 'Could not check room recordings' }, 
      { status: 500 }
    );
  }
} 