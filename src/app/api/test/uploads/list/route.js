import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/api/test/uploads/list`);
    
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch test uploads' },
        { status: res.status }
      );
    }
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching test uploads:', error);
    return NextResponse.json(
      { error: 'Server error fetching test uploads' },
      { status: 500 }
    );
  }
} 