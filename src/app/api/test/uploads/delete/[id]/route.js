import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export async function DELETE(request, { params }) {
  const { id } = params;
  
  try {
    const res = await fetch(`${API_URL}/api/test/uploads/${id}`, {
      method: 'DELETE'
    });
    
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to delete test file' },
        { status: res.status }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting test file:', error);
    return NextResponse.json(
      { error: 'Server error deleting test file' },
      { status: 500 }
    );
  }
} 