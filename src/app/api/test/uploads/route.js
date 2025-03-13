import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export async function POST(request) {
  try {
    const formData = await request.formData();
    
    console.log('Test upload initiated:', {
      fileSize: formData.get('video').size,
      testId: formData.get('testId')
    });
    
    const res = await fetch(`${API_URL}/api/test/uploads`, {
      method: 'POST',
      body: formData
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Upload failed:', errorText);
      return NextResponse.json(
        { error: 'Failed to upload test file' },
        { status: res.status }
      );
    }
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error handling test upload:', error);
    return NextResponse.json(
      { error: 'Server error during test upload' },
      { status: 500 }
    );
  }
} 