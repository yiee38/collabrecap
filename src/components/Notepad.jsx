import React, { useRef, useState, useEffect, useImperativeHandle, useCallback } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { FaLink } from 'react-icons/fa';
import { FaUnlink } from "react-icons/fa";
import { socketService } from '@/lib/socketService';
import WarningDialog from './WarningDialog';
import Quill from 'quill';

import "./Note.css"

class CustomTimestampBlot extends Quill.import('blots/inline') {
  static create(value) {
    const node = super.create();
    node.setAttribute('data-timestamp', value.currentTime);
    node.setAttribute('contenteditable', 'false');
    return node;
  }

  static value(node) {
    return {
      timestamp: node.getAttribute('data-timestamp')
    };
  }
}

CustomTimestampBlot.blotName = 'timestamp';
CustomTimestampBlot.tagName = 'span';

if (typeof window !== 'undefined') {  
  Quill.register(CustomTimestampBlot);
}

const LineNumber = ({ line, isHovering, setIsHovering, roomState, onClick, formatTime, paddingTop, onTimestampClick }) => {
  const getColor = (isLinked, state) => {
    switch (state) {
      case 'ACTIVE':
        return isLinked ? '#dc2626' : '#22c55e';
      case 'ARCHIVED':
        return isLinked ? '#2563eb' : '#94a3b8';
      default:
        return '#94a3b8';
    };
  };

  const style = {
    height: '18.45px',
    margin: line.paddingTop ? `${line.paddingTop}px 0 0` : 0,
    fontFamily: 'monospace',
    color: getColor(line.linked, roomState),
    paddingTop: `${paddingTop}px`,
    lineHeight: '18.45px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
  };

  const handleClick = () => {
    if (roomState === 'ARCHIVED' && line.time) {
      onTimestampClick(line.time);
    } else {
      onClick(line);
    }
  };

  switch (roomState) {
    case 'ACTIVE':
      return (
        <div 
          style={style}
          onClick={handleClick}
          onMouseEnter={() => setIsHovering(line.number)}
          onMouseLeave={() => setIsHovering(null)}
        >
          {isHovering === line.number 
            ? (line.linked 
                ? <FaUnlink style={{ cursor: 'pointer', color: '#dc2626' }} />  
                : <FaLink style={{ cursor: 'pointer', color: '#22c55e' }} />)
            : line.number
          }
        </div>
      );

    case 'ARCHIVED':
      return (
        <div 
          style={{...style, cursor: line.time ? 'pointer' : 'default'}}
          onMouseEnter={() => setIsHovering(line.number)}
          onMouseLeave={() => setIsHovering(null)}
          onClick={handleClick}
        >
          {isHovering === line.number && line.time ? formatTime(line.time) : line.number}
        </div>
      );

    default:
      return <div style={style}>{line.number}</div>;
  }
};

const TimestampNotepad = ({ baseTimeRef, roomState, ref, onTimestampClick, currentTime, initialContent, initialNoteLines }) => {
  const [lineNumbers, setLineNumbers] = useState([]);
  const quillRef = useRef(null);
  const [value, setValue] = useState('');
  const lineNumbersRef = useRef(null);
  const basicLineHeight = useRef(0);
  const innerPadding = useRef(0);
  const baseFontSize = useRef(0);
  const endTimeRef = useRef(null);
  const [isHovering, setIsHovering] = useState(-1);
  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [pendingLinkLine, setPendingLinkLine] = useState(null);
  const [warningMessage, setWarningMessage] = useState('');
  const roomStateRef = useRef(roomState);
  const currentTimeRef = useRef(currentTime);

  useImperativeHandle(ref, () => ({
    setManualTimestamp: () => {
      if (!quillRef.current) return;
      const quillEditor = quillRef.current.getEditor();
      const selection = quillEditor.getSelection();
      
      if (selection) {
        const [leaf] = quillEditor.getLeaf(selection.index);
        const currentLine = leaf?.parent?.domNode;
        
        if (currentLine) {
          const hasTimestamp = currentLine.hasAttribute('data-timestamp');
          if (hasTimestamp) {
            setWarningMessage(`Are you sure you want to update the timestamp?`);
            setIsWarningOpen(true);
            setPendingLinkLine({ number: selection.index });
            return;
          }
          
          const content = currentLine.textContent;
          if (!content.trim()) {
            quillEditor.insertText(selection.index, `Added timestamp #${lineNumbers.length + 1})`);
          }
          handleTextUpdate(null, null, 'user');
        }
      } else {
        const lastIndex = quillEditor.getLength() - 1;
        const [leaf] = quillEditor.getLeaf(lastIndex);
        const lastLine = leaf?.parent?.domNode;
        
        if (lastLine) {
          const content = lastLine.textContent;
          if (!content.trim()) {
            quillEditor.insertText(lastIndex, `Added timestamp #${lineNumbers.length + 1})`);
          } else {
            quillEditor.insertText(lastIndex, '\n');
            quillEditor.insertText(lastIndex + 1, `Added timestamp #${lineNumbers.length + 1})`);
          }
          handleTextUpdate(null, null, 'user');
        }
      }
    }
  }), [lineNumbers.length]);

  useEffect(() => {
    roomStateRef.current = roomState;
    if (roomState === 'ARCHIVED' && !endTimeRef.current) {
      endTimeRef.current = Date.now();
    }
  }, [roomState]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    if (initialContent && initialNoteLines) {
      if (quillRef.current) {
        const quillEditor = quillRef.current.getEditor();
        setLineNumbers(initialNoteLines);

        quillEditor.setText(initialContent, 'api');
        const editorLines = quillEditor.root.children;
        const totalLines = Math.max(editorLines.length, 1);
        for (let i = 0; i < totalLines; i++) {
          const line = editorLines[i];
          const content = line?.innerText || '';
          const hasContent = content.trim() !== '';
          if (hasContent) {
            line.setAttribute('data-timestamp', initialNoteLines[i]?.time || Date.now().toString());
            line.setAttribute('data-linked', 'true');
          }
          else {
            line?.removeAttribute('data-timestamp');
            line?.removeAttribute('data-linked');
          }
        }
      }
    }
  }, [initialContent, initialNoteLines]);

  const formatTime = (timestamp) => {
    if (timestamp <= baseTimeRef.current || roomState === 'CREATED') {
      return "00:00";
    }
    
    if (roomState === 'ARCHIVED' && timestamp > endTimeRef.current) {
      const relativeTime = timestamp - baseTimeRef.current;
      const minutes = Math.floor(relativeTime / 60000);
      const seconds = Math.floor((relativeTime % 60000) / 1000);
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    const relativeTime = timestamp - baseTimeRef.current;
    const minutes = Math.floor(relativeTime / 60000);
    const seconds = Math.floor((relativeTime % 60000) / 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (quillRef.current) {
      const editorElement = document.querySelector('.ql-editor');
      if (editorElement) {
        basicLineHeight.current = parseFloat(window.getComputedStyle(editorElement).lineHeight);
        innerPadding.current = parseFloat(window.getComputedStyle(editorElement).paddingTop) + 2;
        baseFontSize.current = parseFloat(window.getComputedStyle(editorElement).fontSize);
      }

      const quillEditor = quillRef.current.getEditor();
      quillEditor.on('text-change', handleTextUpdate);
      
      quillEditor.root.addEventListener('scroll', () => {
        if (lineNumbersRef.current) {
          lineNumbersRef.current.scrollTop = quillEditor.root.scrollTop;
        }
      });

      return () => quillEditor.off('text-change', handleTextUpdate);
    }
  }, []);

  const handleTextUpdate = (delta, oldDelta, source) => {
    const quillEditor = quillRef.current.getEditor();
    const editorLines = quillEditor.root.children;
    const totalLines = Math.max(editorLines.length, 1);
    if (source !== 'api') {
      const newLineNumbers = [];

      for (let i = 0; i < totalLines; i++) {
        const line = editorLines[i];
        const content = line?.innerText || '';
        const hasContent = content.trim() !== '';

        let lineData = {
          number: i + 1,
          height: line?.offsetHeight + 0.45 || basicLineHeight.current,
          content: content,
          linked: false
        };

        if (hasContent) {
          let timestamp = line.getAttribute('data-timestamp');
          
          if (!timestamp) {
            if (roomStateRef.current === 'ARCHIVED') {
              const timelinePosition = baseTimeRef.current + currentTimeRef.current;
              timestamp = timelinePosition.toString();
            } else {
              timestamp = Date.now().toString();
            }
            line.setAttribute('data-timestamp', timestamp);
            line.setAttribute('data-linked', 'true');
          }

          let parsedTimestamp = parseInt(timestamp);
          lineData.time = parsedTimestamp;
          lineData.linked = true;
        } else {
          line?.removeAttribute('data-timestamp');
          line?.removeAttribute('data-linked');
        }

        newLineNumbers.push(lineData);
      }

      if (!socketService.socket?.connected) {
        socketService.connect(process.env.NEXT_PUBLIC_SOCKET_URL);
      }
      socketService.pushNote(quillEditor.getText(), newLineNumbers);
      setLineNumbers(newLineNumbers);
    }
  };

  const handleLineClick = (line) => {
    if (line.time && (roomState === 'ACTIVE' || roomState === 'ARCHIVED')) {
      setWarningMessage(`Are you sure you want to unlink the timestamp at ${formatTime(line.time)}?`);
      setIsWarningOpen(true);
      setPendingLinkLine(line);
    }
  };

  const handleConfirmLink = () => {
    if (pendingLinkLine) {
      const quillEditor = quillRef.current.getEditor();
      const [leaf] = quillEditor.getLeaf(pendingLinkLine.number);
      const currentLine = leaf?.parent?.domNode;
      
      if (currentLine) {
        if (warningMessage.includes('unlink')) {
          currentLine.removeAttribute('data-timestamp');
          currentLine.removeAttribute('data-linked');
        } else {
          if (roomStateRef.current === 'ARCHIVED') {
            const timelinePosition = baseTimeRef.current + currentTimeRef.current;
            currentLine.setAttribute('data-timestamp', timelinePosition.toString());
          } else {
            currentLine.setAttribute('data-timestamp', Date.now().toString());
          }
          currentLine.setAttribute('data-linked', 'true');
        }
        handleTextUpdate(null, null, 'user');
      }
    }
    setIsWarningOpen(false);
    setWarningMessage('');
    setPendingLinkLine(null);
  };

  return (
    <div className="flex flex-col gap-3 overflow-hidden">
      <div className="flex flex-row w-[500px] px-8 py-8 border border-gray-200 rounded-lg bg-white">
        <div className="flex flex-row w-full h-[450px]">
          <div 
            className="line-numbers h-full" 
            ref={lineNumbersRef}
            style={{ 
              paddingTop: `${innerPadding.current}px`,
              paddingBottom: `${innerPadding.current}px`,
              fontSize: `${baseFontSize.current}px`,
              height: '100%'
            }}
          >
            <div className="min-h-full overflow-hidden">
              {lineNumbers.map((line, index) => {
                const paddingTop = index === 0 && line.number > 1 
                ? (line.number - 1) * basicLineHeight.current 
                : (index > 0 && line.number - lineNumbers[index - 1].number > 1)
                  ? (line.number - lineNumbers[index - 1].number - 1) * basicLineHeight.current
                  : 0;
                return (<LineNumber
                  key={index}
                  line={line}
                  isHovering={isHovering}
                  setIsHovering={setIsHovering}
                  roomState={roomState}
                  onClick={() => handleLineClick(line)}
                  formatTime={formatTime}
                  paddingTop={paddingTop}
                  onTimestampClick={onTimestampClick}
                  onMouseEnter={() => setIsHovering(true)}
                  onMouseLeave={() => setIsHovering(false)}
                />)
              })}
            </div>
          </div>
          <div className="editor-wrapper" style={{ height: '100%' }}>
            <ReactQuill
              ref={quillRef}
              value={value || '\n'}
              onChange={setValue}
              theme="snow"
              modules={{ toolbar: false }}
              className="h-full border border-black overflow-x-hidden break-words whitespace-pre-wrap"
            />
          </div>
        </div>
      </div>
      <WarningDialog 
        isOpen={isWarningOpen}
        onClose={() => setIsWarningOpen(false)}
        onConfirm={handleConfirmLink}
        message={warningMessage}
      />
    </div>
  );
};

export default TimestampNotepad;
