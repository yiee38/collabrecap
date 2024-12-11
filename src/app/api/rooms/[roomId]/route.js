import { MongoClient } from 'mongodb';
import { NextResponse } from 'next/server';

const uri = process.env.ATLAS_URI || "mongodb://localhost:27017";
const client = new MongoClient(uri);

export async function GET(req, { params }) {
  try {
    const { roomId } = params;

    await client.connect();
    const db = client.db("collabrecap");
    const roomsCollection = db.collection("rooms");

    const room = await roomsCollection.findOne({ id: roomId });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(room);
  } catch (error) {
    console.error('Failed to fetch room:', error);
    return NextResponse.json(
      { error: 'Failed to fetch room' },
      { status: 500 }
    );
  } finally {
    await client.close();
  }
}

export async function PATCH(req, { params }) {
  try {
    const { roomId } = params;
    const updates = await req.json();

    await client.connect();
    const db = client.db("collabrecap");
    const roomsCollection = db.collection("rooms");

    const result = await roomsCollection.updateOne(
      { id: roomId },
      { 
        $set: {
          ...updates,
          updatedAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    const updatedRoom = await roomsCollection.findOne({ id: roomId });
    return NextResponse.json(updatedRoom);
  } catch (error) {
    console.error('Failed to update room:', error);
    return NextResponse.json(
      { error: 'Failed to update room' },
      { status: 500 }
    );
  } finally {
    await client.close();
  }
}