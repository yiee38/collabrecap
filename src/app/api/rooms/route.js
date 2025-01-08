import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

const uri = process.env.ATLAS_URI || "mongodb://localhost:27017";
const client = new MongoClient(uri);

// Handle GET request for user's room history
export async function GET(request) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    await client.connect();
    const db = client.db("collabrecap");
    const roomsCollection = db.collection("archivedRooms");

    // Get all archived rooms for this user
    const rooms = await roomsCollection
      .find({
        $or: [
          { "roles.interviewer": userId },
          { "roles.interviewee": userId }
        ]
      })
      .sort({ createdAt: -1 })
      .toArray();
    
    return NextResponse.json({ rooms });
  } catch (error) {
    console.error('Failed to fetch rooms:', error);
    return NextResponse.json({ error: 'Failed to fetch rooms' }, { status: 500 });
  } finally {
    await client.close();
  }
}
