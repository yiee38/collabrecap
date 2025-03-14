import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const CACHE_SETTINGS = {
  INITIAL_SEGMENT: 3600,
  REGULAR_SEGMENT: 1800,
  COMMON_SEEK_POINTS: 3600
};

export async function GET(request, { params }) {
  const { id } = params;
  
  try {
    const inm = request.headers.get('if-none-match');
    
    if (inm) {
      const requestEtag = `"${id}-${request.headers.get('range') || 'full'}"`;
      
      if (inm === requestEtag) {
        console.log(`Cache hit for ${id}, returning 304 Not Modified`);
        return new Response(null, {
          status: 304,
          headers: {
            'Cache-Control': 'public, max-age=3600',
            'ETag': requestEtag
          }
        });
      }
    }
    
    const options = { 
      headers: {
        'Accept': '*/*',
      }
    };
    
    const rangeHeader = request.headers.get('range');
    let rangeValue = null;
    let isInitialSegment = false;
    let isCommonSeekPoint = false;
    
    if (rangeHeader) {
      const matches = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
      
      if (matches) {
        const start = parseInt(matches[1], 10);
        const end = matches[2] ? parseInt(matches[2], 10) : undefined;
        
        if (!isNaN(start) && (end === undefined || (!isNaN(end) && end > start))) {
          rangeValue = `bytes=${start}-${end !== undefined ? end : ''}`;
          options.headers['Range'] = rangeValue;
          
          isInitialSegment = start === 0;
          console.log(`Range request: ${rangeValue} - ${isInitialSegment ? 'initial segment' : 'seeking'}`);
        } else {
          console.warn(`Invalid range request: ${rangeHeader}`);
        }
      } else {
        console.warn(`Malformed range header: ${rangeHeader}`);
      }
    } else {
      isInitialSegment = true;
    }
    
    const response = await fetch(`${API_URL}/api/test/uploads/stream/${id}`, options);
    
    if (!response.ok && response.status !== 206) {
      console.error(`Failed to stream video: HTTP ${response.status}`);
      return NextResponse.json(
        { error: 'Failed to stream test video' },
        { status: response.status }
      );
    }
    
    const headers = new Headers();
    
    const headersToForward = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified'
    ];
    
    for (const header of headersToForward) {
      if (response.headers.has(header)) {
        headers.set(header, response.headers.get(header));
      }
    }
    
    if (!headers.has('content-type')) {
      headers.set('content-type', 'video/mp4');
    }
    
    headers.set('accept-ranges', 'bytes');
    
    headers.set('access-control-allow-origin', '*');
    headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
    headers.set('access-control-allow-headers', 'Range, Content-Type, Accept, Content-Range, If-None-Match');
    
    let maxAge = CACHE_SETTINGS.REGULAR_SEGMENT;
    
    if (isInitialSegment) {
      maxAge = CACHE_SETTINGS.INITIAL_SEGMENT;
    } else if (isCommonSeekPoint) {
      maxAge = CACHE_SETTINGS.COMMON_SEEK_POINTS;
    }
    
    headers.set('cache-control', `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
    
    const etag = `"${id}-${rangeValue || 'full'}"`;
    headers.set('etag', etag);
    
    if (rangeValue && !headers.has('content-range') && headers.has('content-length')) {
      try {
        const totalSize = parseInt(headers.get('content-length'), 10);
        
        if (!isNaN(totalSize) && totalSize > 0) {
          const parts = rangeValue.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
          
          if (!isNaN(start) && !isNaN(end) && end >= start && start < totalSize) {
            const actualEnd = Math.min(end, totalSize - 1);
            headers.set('content-range', `bytes ${start}-${actualEnd}/${totalSize}`);
            headers.set('content-length', String(actualEnd - start + 1));
            
            if (totalSize > 0) {
              const percentage = start / totalSize;
              isCommonSeekPoint = (
                (percentage > 0.20 && percentage < 0.30) || 
                (percentage > 0.45 && percentage < 0.55) || 
                (percentage > 0.70 && percentage < 0.80)
              );
              
              if (isCommonSeekPoint) {
                headers.set('cache-control', `public, max-age=${CACHE_SETTINGS.COMMON_SEEK_POINTS}, stale-while-revalidate=${CACHE_SETTINGS.COMMON_SEEK_POINTS * 2}`);
                console.log(`Enhanced caching for common seek point at ${Math.round(percentage * 100)}%`);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Error calculating content-range:', err);
      }
    }
    
    return new Response(response.body, {
      status: rangeValue ? 206 : 200,
      headers
    });
  } catch (error) {
    console.error('Error streaming test file:', error);
    return NextResponse.json(
      { error: 'Server error streaming video file: ' + error.message },
      { status: 500 }
    );
  }
} 