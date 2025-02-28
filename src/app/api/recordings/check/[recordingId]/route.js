import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export async function GET(request, { params }) {
  const { recordingId } = params;
  
  try {
    const url = `${API_URL}/api/recordings/check/${recordingId}`;
    const res = await fetch(url);
    
    if (!res.ok) {
      return NextResponse.json(
        { exists: false, error: 'Recording not found' }, 
        { status: res.status }
      );
    }
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('API Error:', err);
    return NextResponse.json(
      { exists: false, error: 'Could not check recording' }, 
      { status: 500 }
    );
  }
} 