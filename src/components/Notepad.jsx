import React, { useRef, useState, useEffect } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { FaLink } from 'react-icons/fa';
import { FaUnlink } from "react-icons/fa";
import Quill from 'quill';
import "./Note.css"


const LineNumber = ({ line, isHovering, setIsHovering, roomState, onClick, formatTime, paddingTop }) => {


  const getColor = (isLinked, state) => {
    switch (state) {
      case 'ACTIVE':
        return isLinked ? '#dc2626' : '#22c55e'; // Red for linked (unlink action), green for unlinked (link action)
      case 'ARCHIVED':
        return isLinked ? '#2563eb' : '#94a3b8'; // Blue for linked, light gray for unlinked
      default:
        return '#94a3b8'; // Default gray for CREATED state
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

  switch (roomState) {
    case 'ACTIVE':
      return (
        <div 
          style={style}
          onClick={onClick}
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
        >
          {isHovering === line.number && line.time ? formatTime(line.time) : line.number}
        </div>
      );

    default:
      return <div style={style}>{line.number}</div>;
  }
};

const TimestampNotepad = ({ baseTimeRef, roomState }) => {
  const [lineNumbers, setLineNumbers] = useState([]);
  const quillRef = useRef(null);
  const [value, setValue] = useState('');
  const lineNumbersRef = useRef(null);
  const basicLineHeight = useRef(0);
  const innerPadding = useRef(0);
  const baseFontSize = useRef(0);
  const endTimeRef = useRef(null);
  const [isHovering, setIsHovering] = useState(-1);

  useEffect(() => {
    if (roomState === 'ARCHIVED' && !endTimeRef.current) {
      endTimeRef.current = Date.now();
    }
  }, [roomState]);

  const formatTime = (timestamp) => {
    if (timestamp <= baseTimeRef.current && roomState !== 'CREATED') {
      return "00:00";
    }
    
    // After interview ended
    if (roomState === 'ARCHIVED' && timestamp > endTimeRef.current) {
      const duration = endTimeRef.current - baseTimeRef.current;
      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    // During interview
    const relativeTime = timestamp - baseTimeRef.current;
    const minutes = Math.floor(relativeTime / 60000);
    const seconds = Math.floor((relativeTime % 60000) / 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

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
  Quill.register(CustomTimestampBlot);

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

  const handleTextUpdate = () => {
    const quillEditor = quillRef.current.getEditor();
    const editorLines = quillEditor.root.children;
    const totalLines = Math.max(editorLines.length, 1);
    const newLineNumbers = [];

    for (let i = 0; i < totalLines; i++) {
      const line = editorLines[i];
      const content = line?.innerText || '';
      const hasContent = content.trim() !== '';
      let linked = line.getAttribute('data-linked');
      

      let lineData = {
        number: i + 1,
        height: line?.offsetHeight + 0.45 || basicLineHeight.current,
        content: content,
        linked: linked,
      };

      if (hasContent) {
        let timestamp = parseInt(line.getAttribute('data-timestamp')) || Date.now();
        if (roomState === 'ARCHIVED') {
          timestamp = timestamp < baseTimeRef.current ? baseTimeRef.current : 
                     timestamp > endTimeRef.current ? endTimeRef.current : 
                     timestamp;
        }
        line?.setAttribute('data-timestamp', timestamp);
        lineData.time = timestamp;
        line?.setAttribute('data-linked', true);
        lineData.linked = true;
      }

      newLineNumbers.push(lineData);
    }
    
    setLineNumbers(newLineNumbers);
  };

  const handleLineClick = (line) => {
    if (line.time && (roomState === 'ACTIVE' || roomState === 'ARCHIVED')) {
      console.log(`Clicked timestamp: ${formatTime(line.time)}`);
    }
  };

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    overflow: 'hidden'
  };

  const editorContainerStyle = {
    display: 'flex',
    flexDirection: 'row',
    width: '500px',
    padding: '33px 16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: '#fff'
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
                  paddingTop = {paddingTop}

                  onMouseEnter={() => setIsHovering(true)}
                  onMouseLeave={() => setIsHovering(false)}
                />)
              })}
            </div>
          {/**Here */}
          </div>
          <div className="editor-wrapper" style={{ height: '100%' }}>
            <ReactQuill
              ref={quillRef}
              value={value}
              onChange={setValue}
              theme="snow"
              modules={{ toolbar: false }}
              className="h-full border border-black overflow-x-hidden break-words whitespace-pre-wrap"
            />
          </div>
        </div>
      </div>
    </div>
  );
};


export default TimestampNotepad;