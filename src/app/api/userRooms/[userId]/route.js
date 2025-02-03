import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

const uri = process.env.ATLAS_URI || "mongodb://localhost:27017";
const client = new MongoClient(uri);

export async function GET(request, { params }) {
  try {
    const { userId } = params;
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    const activeRoomsRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/activeRooms/${userId}`);
    const activeRooms = await activeRoomsRes.json();

    await client.connect();
    const db = client.db("collabrecap");
    const roomsCollection = db.collection("archivedRooms");

    const archivedRoomsInterviewer = await roomsCollection
      .find({
        "roles.interviewer": userId
      })
      .sort({ createdAt: -1 })
      .toArray();

    const archivedRoomsInterviewee = await roomsCollection
      .find({
        "roles.interviewee": userId
      })
      .sort({ createdAt: -1 })
      .toArray();

    const rooms = {
      interviewer: [...activeRooms.interviewer, ...archivedRoomsInterviewer],
      interviewee: [...activeRooms.interviewee, ...archivedRoomsInterviewee]
    };
    
    return NextResponse.json({ rooms });
  } catch (error) {
    console.error('Failed to fetch rooms:', error);
    return NextResponse.json({ error: 'Failed to fetch rooms' }, { status: 500 });
  } finally {
    await client.close();
  }
}
