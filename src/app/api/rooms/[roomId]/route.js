import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

const uri = process.env.ATLAS_URI || "mongodb://localhost:27017";
const client = new MongoClient(uri);

export async function GET(request, { params }) {
  try {
    const { roomId } = await params;
    if (!roomId) {
      return NextResponse.json({ error: 'Room ID required' }, { status: 400 });
    }

    await client.connect();
    const db = client.db("collabrecap");
    const roomsCollection = db.collection("archivedRooms");

    const room = await roomsCollection.findOne({ id: roomId });
    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }
    
    return NextResponse.json(room);
  } catch (error) {
    console.error('Failed to fetch room:', error);
    return NextResponse.json({ error: 'Failed to fetch room' }, { status: 500 });
  } finally {
    await client.close();
  }
}
