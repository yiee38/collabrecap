'use client';

import React, { useState, useRef, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { EditorView } from '@codemirror/view';
import CollaborationService from '@/lib/collaborationService';
import { useRouter } from 'next/navigation';

const wrapStyle = EditorView.lineWrapping;

const customStyle = {
  container: {
    width: '500px',
    margin: '0 auto',
    padding: '16px',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    backgroundColor: 'white',
  },
  editorWrapper: {
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    overflow: 'hidden',
    marginTop: '16px',
    marginBottom: '16px',
  },
  timelineContainer: {
    marginTop: '16px',
  }
};

const CodeEditor = ({
  isInterviewActive, 
  interviewStartTime,
  onOperationsUpdate, 
  isPlaying,
  onSeek,
  onDragStart,
  onDragEnd,
  currentTimeOverride,
  roomId, 
  userId, 
  role, 
}) => {
  const [content, setContent] = useState('');
  const [operations, setOperations] = useState([]);
  const editorRef = useRef(null);
  const collaborationRef = useRef(null);

  const handleChange = (value, viewUpdate) => {
    if (!isInterviewActive || isPlaying) return;

    const changes = [];
    viewUpdate.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      changes.push({
        from: fromA,
        to: toA,
        text: inserted.toString(),
        timestamp: Date.now() - interviewStartTime
      });
    });

    setContent(value);
    const newOps = [...operations, ...changes];
    const newDuration = Math.max(...newOps.map(op => op.timestamp));
    setOperations(newOps);
    onOperationsUpdate?.(newOps, newDuration);
  };

  const getContentAtTime = (targetTime) => {
    try {
      let result = '';
      for (const op of operations) {
        if (op.timestamp > targetTime) break;
        const fromPos = Math.min(op.from, result.length);
        const toPos = Math.min(op.to, result.length);
        result = result.slice(0, fromPos) + op.text + result.slice(toPos);
      }
      return result;
    } catch (error) {
      console.error('Error in getContentAtTime:', error);
      return content;
    }
  };

  const formatTime = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  };

  useEffect(() => {
    const newContent = getContentAtTime(currentTimeOverride);
    if (newContent !== content) {
      setContent(newContent);
    }
  }, [currentTimeOverride]);

  // Initialize CollaborationService
  useEffect(() => {
    if (!roomId) return;

    collaborationRef.current = new CollaborationService(roomId, userId, role);

    return () => {
      collaborationRef.current?.destroy();
    };
  }, [roomId, userId, role]);


  return (
    <div className="w-[500px] mx-auto p-4 border border-gray-200 rounded-lg bg-white">
      <div className="border border-gray-200 rounded-md overflow-hidden mt-4 mb-4">
        <CodeMirror
          ref={editorRef}
          value={content}
          height='450px'
          theme="dark"
          extensions={[javascript(), wrapStyle, ...(collaborationRef.current?.getExtensions() || [])]}
          onChange={handleChange}
          editable={isInterviewActive && !isPlaying}
          basicSetup={{
            lineNumbers: true,
            indentOnInput: true,
            syntaxHighlighting: true,
            closeBrackets: true,
            defaultKeymap: true,
            historyKeymap: true,
          }}
          style={{ overflow: 'scroll' }}
        />
      </div>

      
    </div>
  );
};

export default CodeEditor;