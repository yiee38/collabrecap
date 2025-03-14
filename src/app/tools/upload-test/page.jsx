'use client';

import { useState, useRef, useEffect } from 'react';

export default function UploadTestPage() {
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoSeeking, setVideoSeeking] = useState(false);
  const [videoError, setVideoError] = useState(null);
  const [bufferingStrategy, setBufferingStrategy] = useState('auto');
  const [videoQuality, setVideoQuality] = useState('auto');
  const [bufferHealth, setBufferHealth] = useState(0);
  const fileInputRef = useRef();
  const videoRef = useRef();
  const videoContainerRef = useRef();

  const fetchUploadedFiles = async () => {
    try {
      const res = await fetch('/api/test/uploads/list');
      if (res.ok) {
        const data = await res.json();
        setUploadedFiles(data.files || []);
      } else {
        console.error('Failed to fetch uploads');
      }
    } catch (error) {
      console.error('Error fetching uploads:', error);
    }
  };

  useEffect(() => {
    fetchUploadedFiles();
  }, []);

  useEffect(() => {
    if (selectedFile && videoRef.current) {
      setVideoLoading(true);
      setVideoSeeking(false);
      setVideoError(null);
      setBufferHealth(0);
      
      const videoElement = videoRef.current;
      videoElement.src = '';
      videoElement.load();
      
      if (bufferingStrategy === 'eager') {
        videoElement.preload = 'auto';
        videoElement.setAttribute('autobuffer', '');
      } else if (bufferingStrategy === 'lazy') {
        videoElement.preload = 'metadata';
      } else {
        videoElement.preload = 'auto';
      }
      
      if ('webkitAudioDecodedByteCount' in videoElement) {
        videoElement.webkitPreservesPitch = true;
      }
      
      if ('playbackRate' in videoElement) {
        videoElement.playbackRate = 1.0;
      }
      
      const fileSize = selectedFile.size || 0;
      const qualitySuffix = videoQuality !== 'auto' ? `?quality=${videoQuality}` : '';
      const sizeSuffix = fileSize > 50 * 1024 * 1024 ? (qualitySuffix ? '&optimize=1' : '?optimize=1') : '';
      
      videoElement.src = `/api/test/uploads/stream/${selectedFile.id}${qualitySuffix}${sizeSuffix}`;
      
      const handleError = (e) => {
        console.error('Video element error:', e);
        console.error('Video network state:', videoElement.networkState);
        console.error('Video ready state:', videoElement.readyState);
        if (videoElement.error) {
          console.error('Video error code:', videoElement.error.code);
          console.error('Video error message:', videoElement.error.message);
        }
      };
      
      videoElement.addEventListener('error', handleError, true);
      
      videoElement.onloadedmetadata = () => {
        setVideoLoading(false);
      };

      videoElement.addEventListener('progress', () => {
        if (videoElement.buffered.length > 0) {
          const bufferedEnd = videoElement.buffered.end(videoElement.buffered.length - 1);
          const duration = videoElement.duration;
          const bufferedPercent = (bufferedEnd / duration) * 100;
          
          if (videoQuality === 'auto' && bufferedPercent < 10 && duration > 0 && bufferedEnd / duration < 0.1) {
            if (videoSeeking) {
              const currentTime = videoElement.currentTime;
              setVideoQuality('low');
              videoElement.src = `/api/test/uploads/stream/${selectedFile.id}?quality=low&optimize=1`;
              videoElement.currentTime = currentTime;
            }
          }
        }
      });

      const bufferMonitor = setInterval(() => {
        if (videoElement.buffered.length > 0) {
          const currentTime = videoElement.currentTime;
          const bufferedEnd = videoElement.buffered.end(videoElement.buffered.length - 1);
          const bufferedAhead = bufferedEnd - currentTime;
          setBufferHealth(bufferedAhead);
          
          if (bufferedAhead < 2 && videoQuality !== 'low' && videoElement.readyState < 4) {
            console.log('Buffer critically low, reducing quality');
            setVideoQuality('low');
            const currentTime = videoElement.currentTime;
            videoElement.src = `/api/test/uploads/stream/${selectedFile.id}?quality=low&optimize=1`;
            videoElement.currentTime = currentTime;
          }
        }
      }, 1000);

      return () => {
        clearInterval(bufferMonitor);
      };
    }
  }, [selectedFile, bufferingStrategy, videoQuality]);

  const handleUpload = async (e) => {
    e.preventDefault();
    
    const fileInput = fileInputRef.current;
    if (!fileInput.files.length) {
      alert('Please select a file to upload');
      return;
    }
    
    const file = fileInput.files[0];
    if (!file.type.includes('video/')) {
      alert('Please select a video file');
      return;
    }
    
    setUploading(true);
    setUploadResult(null);
    
    try {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('testId', 'test-' + Date.now());
      
      const res = await fetch('/api/test/uploads', {
        method: 'POST',
        body: formData
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setUploadResult({
          success: true,
          message: 'Upload successful!',
          data
        });
        fileInput.value = '';
        fetchUploadedFiles();
      } else {
        setUploadResult({
          success: false,
          message: data.error || 'Upload failed'
        });
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadResult({
        success: false,
        message: 'Error uploading file: ' + error.message
      });
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (file) => {
    setSelectedFile(file);
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    
    if (!confirm('Are you sure you want to delete this test video?')) {
      return;
    }
    
    setDeleting(true);
    
    try {
      const res = await fetch(`/api/test/uploads/delete/${id}`, {
        method: 'DELETE'
      });
      
      if (res.ok) {
        if (selectedFile && selectedFile.id === id) {
          setSelectedFile(null);
        }
        
        fetchUploadedFiles();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete file');
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      alert('Error deleting file: ' + error.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleVideoLoadStart = () => {
    setVideoLoading(true);
  };

  const handleVideoCanPlay = () => {
    setVideoLoading(false);
  };

  const handleVideoSeeking = () => {
    setVideoSeeking(true);
  };

  const handleVideoSeeked = () => {
    setVideoSeeking(false);
  };

  const handleVideoWaiting = () => {
    setVideoSeeking(true);
  };

  const handleVideoPlaying = () => {
    setVideoSeeking(false);
    setVideoLoading(false);
  };

  const handleVideoError = (e) => {
    setVideoLoading(false);
    setVideoSeeking(false);
    setVideoError("Error loading video. The file may be corrupted or not accessible.");
    console.error('Video loading error:', e);
  };

  const improveBuffering = () => {
    if (videoRef.current && selectedFile) {
      const videoElement = videoRef.current;
      const currentTime = videoElement.currentTime;
      const duration = videoElement.duration;
      
      if (duration && currentTime < duration - 30) {
        for (let offset = 30; offset <= 90; offset += 20) {
          if (currentTime + offset < duration) {
            const preloadSegment = new XMLHttpRequest();
            const segmentTime = Math.floor((currentTime + offset) / 30);
            const endpoint = `/api/test/uploads/stream/${selectedFile.id}?segment=${segmentTime}`;
            
            preloadSegment.open('GET', endpoint, true);
            preloadSegment.setRequestHeader('Range', `bytes=${Math.floor((currentTime + offset - 10) * 100000)}-${Math.floor((currentTime + offset + 10) * 100000)}`);
            preloadSegment.send();
            
            console.debug(`Preloading segment at ${segmentTime} (${Math.round(currentTime + offset)} seconds)`);
          }
        }
      }
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Video Upload Test Tool</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Upload Test Video</h2>
          <form onSubmit={handleUpload}>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Select Video File</label>
              <input 
                type="file" 
                ref={fileInputRef}
                accept="video/*"
                className="block w-full text-sm border rounded p-2"
              />
            </div>
            <button
              type="submit"
              disabled={uploading}
              className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-300"
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </form>
          
          {uploadResult && (
            <div className={`mt-4 p-3 rounded ${uploadResult.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              <p className="font-medium">{uploadResult.message}</p>
              {uploadResult.data && (
                <pre className="mt-2 text-xs overflow-auto">{JSON.stringify(uploadResult.data, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Previously Uploaded Test Files</h2>
          <button 
            onClick={fetchUploadedFiles}
            className="mb-4 bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded text-sm"
          >
            Refresh List
          </button>
          
          {uploadedFiles.length > 0 ? (
            <ul className="divide-y">
              {uploadedFiles.map(file => (
                <li 
                  key={file.id} 
                  className={`py-2 cursor-pointer ${selectedFile?.id === file.id ? 'bg-blue-50' : ''}`}
                  onClick={() => handleFileSelect(file)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{file.filename}</p>
                      <p className="text-sm text-gray-600">ID: {file.id}</p>
                      <p className="text-sm text-gray-600">Size: {Math.round(file.size / 1024 / 1024 * 100) / 100} MB</p>
                      <p className="text-sm text-gray-600">Uploaded: {new Date(file.uploadDate).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={(e) => handleDelete(file.id, e)}
                      className="bg-red-500 text-white px-2 py-1 rounded text-xs hover:bg-red-600"
                      disabled={deleting}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">No test files uploaded yet</p>
          )}
        </div>
      </div>
      
      {selectedFile && (
        <div className="mt-6 bg-white p-4 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Test Playback</h2>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Buffering Strategy</label>
            <select 
              value={bufferingStrategy} 
              onChange={(e) => setBufferingStrategy(e.target.value)}
              className="block w-full text-sm border rounded p-2"
            >
              <option value="auto">Auto</option>
              <option value="eager">Eager (Preload more)</option>
              <option value="lazy">Lazy (Minimize preload)</option>
            </select>
          </div>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Video Quality</label>
            <select 
              value={videoQuality} 
              onChange={(e) => setVideoQuality(e.target.value)}
              className="block w-full text-sm border rounded p-2"
            >
              <option value="auto">Auto</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          
          <div ref={videoContainerRef} className="aspect-video bg-black rounded overflow-hidden relative">
            {(videoLoading || videoSeeking) && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
                <div className="text-white">
                  <svg className="animate-spin h-8 w-8 mr-3 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>{videoLoading ? 'Loading video...' : 'Buffering...'}</span>
                </div>
              </div>
            )}
            {videoError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
                <div className="text-white text-center p-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-red-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p>{videoError}</p>
                </div>
              </div>
            )}
            <video
              ref={videoRef}
              onLoadStart={handleVideoLoadStart}
              onCanPlay={handleVideoCanPlay}
              onSeeking={handleVideoSeeking}
              onSeeked={handleVideoSeeked}
              onWaiting={handleVideoWaiting}
              onPlaying={handleVideoPlaying}
              onError={handleVideoError}
              onProgress={() => improveBuffering()}
              controls
              playsInline
              autoPlay={false}
              muted={false}
              preload="auto"
              className="w-full h-full"
              controlsList="nodownload nofullscreen"
            />
            
            {/* Buffer Health Indicator */}
            <div className="absolute bottom-12 left-0 right-0 px-4 z-5 pointer-events-none">
              <div className="bg-gray-800 bg-opacity-80 rounded p-2 text-white text-xs">
                <div className="flex justify-between mb-1">
                  <span>Buffer: {bufferHealth.toFixed(1)}s</span>
                  <span>Quality: {videoQuality}</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div 
                    className={`rounded-full h-2 ${
                      bufferHealth < 2 ? 'bg-red-500' : 
                      bufferHealth < 5 ? 'bg-yellow-500' : 'bg-green-500'
                    }`} 
                    style={{width: `${Math.min(bufferHealth/15 * 100, 100)}%`}}
                  ></div>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-between">
            <p className="text-sm">File ID: {selectedFile.id}</p>
            <div>
              <button
                onClick={() => window.open(`/api/test/uploads/stream/${selectedFile.id}`, '_blank')}
                className="bg-blue-500 text-white px-3 py-1 rounded text-sm mr-2"
              >
                Open in New Tab
              </button>
              <button
                onClick={(e) => handleDelete(selectedFile.id, e)}
                className="bg-red-500 text-white px-3 py-1 rounded text-sm"
                disabled={deleting}
              >
                Delete This Video
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 