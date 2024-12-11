import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

const uri = process.env.ATLAS_URI || "mongodb://localhost:27017";
const client = new MongoClient(uri);

// Handle GET request
export async function GET() {
  try {
    await client.connect();
    const db = client.db("collabrecap");
    const roomsCollection = db.collection("rooms");

    const rooms = await roomsCollection.find().toArray();
    
    // Make sure to return a NextResponse
    return NextResponse.json({ rooms });
  } catch (error) {
    console.error('Failed to fetch rooms:', error);
    return NextResponse.json({ error: 'Failed to fetch rooms' }, { status: 500 });
  } finally {
    await client.close();
  }
}

// Handle POST request
export async function POST(request) {
  try {
    const body = await request.json();
    const { roomId, userId, state } = body;

    await client.connect();
    const db = client.db("collabrecap");
    const roomsCollection = db.collection("rooms");

    const room = {
      id: roomId,
      creatorId: userId,
      state: state,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await roomsCollection.insertOne(room);
    
    return NextResponse.json(room);
  } catch (error) {
    console.error('Failed to create room:', error);
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  } finally {
    await client.close();
  }
}