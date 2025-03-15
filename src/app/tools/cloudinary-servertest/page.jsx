'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';

export default function CloudinaryServerTestPage() {
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const { data: session } = useSession();
  
  const uniqueId = useRef(`test-${Date.now()}`).current;
  const userId = session?.user?.email || 'anonymous';
  
  useEffect(() => {
    let stream;
    
    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error('Error accessing camera:', error);
      }
    };
    
    startCamera();
    
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);
  
  const startRecording = () => {
    recordedChunksRef.current = [];
    
    if (!videoRef.current?.srcObject) {
      console.error('No stream available');
      return;
    }
    
    const stream = videoRef.current.srcObject;
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9'
    });
    
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };
    
    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
  };
  
  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;
    
    mediaRecorderRef.current.stop();
    setIsRecording(false);
    
    setTimeout(() => {
      if (recordedChunksRef.current.length > 0) {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        setRecordedBlob(blob);
      }
    }, 500);
  };
  
  const uploadToServerEndpoint = async () => {
    if (!recordedBlob) return;
    
    setUploadStatus('Uploading to server endpoint...');
    
    try {
      const formData = new FormData();
      formData.append('file', recordedBlob);
      formData.append('roomId', uniqueId);
      formData.append('userId', userId);
      formData.append('role', 'tester');
      formData.append('isFinal', 'true');
      
      const response = await fetch('/api/cloudinary/server-upload', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Server upload failed: ${errorData.error || 'Unknown error'}`);
      }
      
      const result = await response.json();
      setVideoUrl(result.url);
      setUploadStatus('Upload successful through server!');
      
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus(`Error: ${error.message}`);
    }
  };
  
  return (
    <div className="flex flex-col items-center p-8 gap-8">
      <h1 className="text-2xl font-bold">Cloudinary Server-Side Upload Test</h1>
      <p className="text-blue-600">Using server-side upload (no client-side signatures)</p>
      <p className="text-gray-500 text-sm max-w-xl text-center">
        This demonstrates uploading through your server instead of directly to Cloudinary.
        Your server handles all authentication with Cloudinary's API, avoiding signature issues.
      </p>
      
      <div className="flex flex-col items-center gap-4">
        <div className="bg-black rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-[640px] h-[480px]"
          />
        </div>
        
        <div className="flex gap-4">
          {!isRecording ? (
            <button
              onClick={startRecording}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
            >
              Start Recording
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
            >
              Stop Recording
            </button>
          )}
          
          <button
            onClick={uploadToServerEndpoint}
            disabled={!recordedBlob}
            className={`px-4 py-2 rounded-md text-white ${
              recordedBlob 
                ? 'bg-green-500 hover:bg-green-600' 
                : 'bg-gray-400 cursor-not-allowed'
            }`}
          >
            Upload via Server
          </button>
        </div>
        
        {uploadStatus && (
          <div className="mt-4 p-3 bg-gray-100 rounded-md">
            {uploadStatus}
          </div>
        )}
      </div>
      
      {videoUrl && (
        <div className="mt-8 flex flex-col items-center gap-4">
          <h2 className="text-xl font-semibold mb-3">Uploaded Video</h2>
          <video
            controls
            playsInline
            className="w-[640px] h-[480px] bg-black rounded-lg"
            src={videoUrl}
          />
          <div className="mt-2 text-sm text-gray-500 break-all">
            URL: {videoUrl}
          </div>
        </div>
      )}
    </div>
  );
} 