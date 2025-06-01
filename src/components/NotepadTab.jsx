import React, { useRef, useState, useEffect, useImperativeHandle, useCallback } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { FaLink } from 'react-icons/fa';
import { FaUnlink } from "react-icons/fa";
import { FaCode } from 'react-icons/fa';
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

class CodeLinkBlot extends Quill.import('blots/inline') {
  static create(value) {
    const node = super.create();
    node.setAttribute('data-coderange', JSON.stringify(value.codeRange));
    node.setAttribute('contenteditable', 'false');
    node.classList.add('code-link');
    if (value.codeRange.text) {
      node.setAttribute('title', value.codeRange.text.substring(0, 100));
    }
    return node;
  }

  static value(node) {
    return {
      codeRange: JSON.parse(node.getAttribute('data-coderange') || '{}')
    };
  }
}

CodeLinkBlot.blotName = 'codelink';
CodeLinkBlot.tagName = 'span';

if (typeof window !== 'undefined') {  
  Quill.register(CustomTimestampBlot);
  Quill.register(CodeLinkBlot);
}

const LineNumber = ({ 
  line, 
  isHovering, 
  setIsHovering, 
  roomState, 
  onClick, 
  formatTime, 
  paddingTop, 
  onTimestampClick,
  onCodeRangeClick = () => {}
}) => {
  const getColor = (isLinked, state, hasCodeRange) => {
    if (hasCodeRange) return '#8b5cf6'; 
    
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
    color: getColor(line.linked, roomState, line.codeRange),
    paddingTop: `${paddingTop}px`,
    lineHeight: '18.45px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
  };

  const handleClick = () => {
    if (roomState === 'ARCHIVED') {
      if (line.codeRange && line.codeRange !== null) {
        onCodeRangeClick(line.codeRange, line.time);
        return;
      }
      
      if (line.time && line.time !== null) {
        onTimestampClick(line.time);
        return;
      }
    } else {
      onClick(line);
    }
  };

  const renderHoverIcon = () => {
    if (line.codeRange) {
      return <FaCode style={{ cursor: 'pointer', color: '#8b5cf6' }} />;
    }
    
    if (line.linked) {
      return <FaUnlink style={{ cursor: 'pointer', color: roomState === 'ACTIVE' ? '#dc2626' : '#2563eb' }} />;
    }
    
    return <FaLink style={{ cursor: 'pointer', color: '#22c55e' }} />;
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
            ? (line.time ? formatTime(line.time) : renderHoverIcon())
            : line.number}
        </div>
      );

    case 'ARCHIVED':
      return (
        <div 
          style={{...style, cursor: (line.time || line.codeRange) ? 'pointer' : 'default'}}
          onMouseEnter={() => setIsHovering(line.number)}
          onMouseLeave={() => setIsHovering(null)}
          onClick={handleClick}
        >
          {isHovering === line.number 
            ? (line.time 
              ? (line.codeRange 
                 ? <span title="Click to view linked code and jump to timestamp">
                     {formatTime(line.time)}
                   </span>
                 : <span title="Click to jump to timestamp">{formatTime(line.time)}</span>)
              : line.number)
            : line.number}
        </div>
      );

    default:
      return <div style={style}>{line.number}</div>;
  }
};

const TimestampNotepad = ({ 
  baseTimeRef, 
  roomState, 
  ref, 
  onTimestampClick, 
  currentTime, 
  initialContent, 
  initialNoteLines, 
  onLiveUpdate,
  onCodeRangeClick = () => {},
  userRole = 'interviewer' 
}) => {
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
  const [pendingCodeLink, setPendingCodeLink] = useState(null);
  const roomStateRef = useRef(roomState);
  const currentTimeRef = useRef(currentTime);
  const lastCursorPositionRef = useRef(null);

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
          
          let timelinePosition;
          
          if (roomStateRef.current === 'CREATED') {
            timelinePosition = 0;
          } else if (roomStateRef.current === 'ARCHIVED') {
            if (baseTimeRef.current !== undefined && baseTimeRef.current !== null) {
              timelinePosition = baseTimeRef.current + currentTimeRef.current;
            } else {
              timelinePosition = Date.now();
            }
          } else {
            timelinePosition = Date.now();
          }
          
          if (timelinePosition <= 0 && roomStateRef.current !== 'CREATED') {
            timelinePosition = Date.now();
          }
          
          currentLine.setAttribute('data-timestamp', timelinePosition.toString());
          currentLine.setAttribute('data-linked', 'true');
          
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
          let timelinePosition;
          
          if (roomStateRef.current === 'CREATED') {
            timelinePosition = 0;
          } else if (roomStateRef.current === 'ARCHIVED') {
            if (baseTimeRef.current !== undefined && baseTimeRef.current !== null) {
              timelinePosition = baseTimeRef.current + currentTimeRef.current;
            } else {
              timelinePosition = Date.now();
            }
          } else {
            timelinePosition = Date.now();
          }
          
          if (timelinePosition <= 0 && roomStateRef.current !== 'CREATED') {
            timelinePosition = Date.now();
          }
          
          lastLine.setAttribute('data-timestamp', timelinePosition.toString());
          lastLine.setAttribute('data-linked', 'true');
          
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
    },

    attachCodeRange: (codeRange) => {
      if (!quillRef.current || !codeRange || typeof codeRange.from !== 'number' || typeof codeRange.to !== 'number') {
        return false; 
      }
      
      if (codeRange.from < 0 || codeRange.to < codeRange.from) {
        console.warn("Invalid code range values:", codeRange);
        return false;
      }
      
      if (!codeRange.text) {
        if (codeRange.contentSnapshot && typeof codeRange.from === 'number' && typeof codeRange.to === 'number') {
          try {
            codeRange.text = codeRange.contentSnapshot.slice(codeRange.from, codeRange.to);
          } catch (e) {
            console.warn("Could not extract text from snapshot:", e);
            codeRange.text = "Unknown code selection";
          }
        } else {
          codeRange.text = "Unknown code selection";
        }
      }
      
      const quillEditor = quillRef.current.getEditor();
      let selection = quillEditor.getSelection();
      
      if (!selection && lastCursorPositionRef.current) {
        selection = lastCursorPositionRef.current;
        quillEditor.setSelection(selection);
      }
      
      if (!selection) {
        const lastIndex = quillEditor.getLength() - 1;
        selection = { index: lastIndex, length: 0 };
        quillEditor.setSelection(selection);
      } 
      
      try {
        const [leaf] = quillEditor.getLeaf(selection.index);
        const currentLine = leaf?.parent?.domNode;
        
        if (currentLine) {
          const existingTimestamp = currentLine.getAttribute('data-timestamp');
          const existingContent = (currentLine.textContent || '').trim();
          const existingCodeRange = currentLine.getAttribute('data-coderange');
          
          if (existingContent && existingTimestamp) {
            if (existingCodeRange) {
              try {
                const existingRange = JSON.parse(existingCodeRange);
                setPendingCodeLink({
                  currentLine,
                  codeRange,
                  existingRange,
                  isEmpty: false,
                  hasExistingContent: true
                });
                setWarningMessage("This line already has content and a code link. Do you want to replace the timestamp and link it to the new code selection?");
                setIsWarningOpen(true);
                return true;
              } catch (e) {
                console.warn("Error parsing existing code range, proceeding with replacement:", e);
              }
            } else {
              setPendingCodeLink({
                currentLine,
                codeRange,
                existingRange: null,
                isEmpty: false,
                hasExistingContent: true
              });
              setWarningMessage("This line already has content and a timestamp. Do you want to update the timestamp and link it to the selected code?");
              setIsWarningOpen(true);
              return true;
            }
          }
          
          return performCodeLink(currentLine, codeRange, !existingContent);
        } else {
          const codePreview = codeRange.text ? 
            (codeRange.text.length > 30 ? 
              codeRange.text.substring(0, 30) + '...' : 
              codeRange.text) : 
            'Selected code';
          
          const onTextChangeOnce = function(delta, oldContents, source) {
            quillEditor.off('text-change', onTextChangeOnce);
            handleTextUpdate(null, null, 'user');
          };
          
          quillEditor.on('text-change', onTextChangeOnce);
          
          quillEditor.insertText(selection.index, `Code: "${codePreview}"`, {
            'code-link': { codeRange }
          });
          
          return true;
        }
      } catch (error) {
        console.error("Error in attachCodeRange:", error);
        return false;
      }
    }
  }), [lineNumbers.length]);

  const performCodeLink = (currentLine, codeRange, isEmpty, replaceExisting = false) => {
    const quillEditor = quillRef.current.getEditor();
    
    currentLine.setAttribute('data-coderange', JSON.stringify(codeRange));
    
    let timelinePosition;
    
    if (roomStateRef.current === 'CREATED') {
      timelinePosition = 0;
    } else if (roomStateRef.current === 'ARCHIVED') {
      if (baseTimeRef.current !== undefined && baseTimeRef.current !== null) {
        timelinePosition = baseTimeRef.current + currentTimeRef.current;
      } else {
        timelinePosition = Date.now();
      }
    } else {
      timelinePosition = Date.now();
    }
    
    if (timelinePosition <= 0 && roomStateRef.current !== 'CREATED') {
      timelinePosition = Date.now();
    }
    
    console.log(`Setting timestamp for code link in ${roomStateRef.current} mode: ${timelinePosition}`);
    currentLine.setAttribute('data-timestamp', timelinePosition.toString());
    currentLine.setAttribute('data-linked', 'true');
    
    if (!currentLine.classList.contains('code-link')) {
      currentLine.classList.add('code-link');
    }
    
    if (isEmpty && !replaceExisting) {
      const lineRef = currentLine;
      const codeRangeData = codeRange;
      
      const onTextChangeOnce = function(delta, oldContents, source) {
        quillEditor.off('text-change', onTextChangeOnce);
        
        if (lineRef && !lineRef.classList.contains('code-link')) {
          lineRef.classList.add('code-link');
          lineRef.setAttribute('data-coderange', JSON.stringify(codeRangeData));
        }
        
        handleTextUpdate(null, null, 'user');
      };
      
      quillEditor.on('text-change', onTextChangeOnce);
      
      const selection = quillEditor.getSelection();
      quillEditor.insertText(selection?.index || quillEditor.getLength() - 1, `Added timestamp #${lineNumbers.length + 1})`);
    } else {
      handleTextUpdate(null, null, 'user');
    }
    
    return true;
  };

  const handleConfirmCodeLink = () => {
    if (pendingCodeLink) {
      const { currentLine, codeRange, isEmpty, hasExistingContent } = pendingCodeLink;
      
      if (hasExistingContent) {
        // For existing content, we just update the timestamp and code link without changing the text
        performCodeLink(currentLine, codeRange, false, true);
      } else {
        // For empty lines, use the original behavior
        performCodeLink(currentLine, codeRange, isEmpty, false);
      }
    }
    
    setIsWarningOpen(false);
    setWarningMessage('');
    setPendingCodeLink(null);
  };

  const handleCancelCodeLink = () => {
    setIsWarningOpen(false);
    setWarningMessage('');
    setPendingCodeLink(null);
  };

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
      console.log("INITIAL CONTENT AND INITIAL NOTELINES")
      console.log(initialContent)
      console.log(initialNoteLines)
      console.log(lineNumbers == [])
      console.log(quillRef.current)
      if (quillRef.current && lineNumbers?.length === 0) {
        console.log("UPadting for the new initial?")
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
            
            if (initialNoteLines[i]?.codeRange) {
              line.setAttribute('data-coderange', JSON.stringify(initialNoteLines[i].codeRange));
              line.classList.add('code-link');
            } else {
              line.classList.remove('code-link');
            }
            
            line.setAttribute('data-linked', 'true');
          }
          else {
            line?.removeAttribute('data-timestamp');
            line?.removeAttribute('data-coderange');
            line?.removeAttribute('data-linked');
            line?.classList.remove('code-link');
          }
        }
      }
    }
  }, [initialContent, initialNoteLines, lineNumbers]);

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
      
      quillEditor.on('selection-change', function(range) {
        if (range) {
          lastCursorPositionRef.current = range;
        }
      });
      
      quillEditor.root.addEventListener('scroll', () => {
        if (lineNumbersRef.current) {
          lineNumbersRef.current.scrollTop = quillEditor.root.scrollTop;
        }
      });

      return () => {
        quillEditor.off('text-change', handleTextUpdate);
        quillEditor.off('selection-change');
      };
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
          linked: false,
          codeRange: null
        };

        if (hasContent) {
          let timestamp = line.getAttribute('data-timestamp');
          
          if (!timestamp) {
            let timelinePosition;
            
            if (roomStateRef.current === 'CREATED') {
              timelinePosition = 0;
            } else if (roomStateRef.current === 'ARCHIVED') {
              if (baseTimeRef.current !== undefined && baseTimeRef.current !== null) {
                timelinePosition = baseTimeRef.current + currentTimeRef.current;
              } else {
                timelinePosition = Date.now();
              }
            } else {
              timelinePosition = Date.now();
            }
            
            if (timelinePosition <= 0 && roomStateRef.current !== 'CREATED') {
              timelinePosition = Date.now();
            }
            
            timestamp = timelinePosition.toString();
            line.setAttribute('data-timestamp', timestamp);
            line.setAttribute('data-linked', 'true');
          }

          const codeRangeAttr = line.getAttribute('data-coderange');
          if (codeRangeAttr) {
            try {
              lineData.codeRange = JSON.parse(codeRangeAttr);
              if (!line.classList.contains('code-link')) {
                line.classList.add('code-link');
              }
            } catch (e) {
              console.error('Error parsing code range:', e);
              lineData.codeRange = null;
              line.classList.remove('code-link');
            }
          } else {
            line.classList.remove('code-link');
          }

          let parsedTimestamp = parseInt(timestamp);
          lineData.time = parsedTimestamp;
          lineData.linked = true;
        } else {
          line?.removeAttribute('data-timestamp');
          line?.removeAttribute('data-coderange');
          line?.removeAttribute('data-linked');
          line?.classList.remove('code-link');
        }

        newLineNumbers.push(lineData);
      }

      if (!socketService.socket?.connected) {
        socketService.connect(process.env.NEXT_PUBLIC_SOCKET_URL);
      }
      
      if (userRole === 'interviewer') {
        socketService.pushInterviewerNote(quillEditor.getText(), newLineNumbers);
      } else if (userRole === 'interviewee') {
        socketService.pushIntervieweeNote(quillEditor.getText(), newLineNumbers);
      }
      
      setLineNumbers(newLineNumbers);
      console.log("LIVE UPDATE!!")  
      onLiveUpdate(quillEditor.getText(), newLineNumbers);
      
      setTimeout(() => {
        const currentSelection = quillEditor.getSelection();
        if (currentSelection) {
          lastCursorPositionRef.current = currentSelection;
        }
      }, 0);
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
        if (warningMessage.includes('unlink') && roomStateRef.current === 'ACTIVE') {
          const newTimestamp = Date.now().toString();
          currentLine.setAttribute('data-timestamp', newTimestamp);
          currentLine.setAttribute('data-linked', 'true');
          
          const updatedLineNumbers = [...lineNumbers];
          const lineIndex = updatedLineNumbers.findIndex(line => line.number === pendingLinkLine.number);
          if (lineIndex !== -1) {
            updatedLineNumbers[lineIndex] = {
              ...updatedLineNumbers[lineIndex],
              time: parseInt(newTimestamp),
              linked: true
            };
            setLineNumbers(updatedLineNumbers);
          }
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
    
    if (pendingCodeLink) {
      handleConfirmCodeLink();
      return;
    }
    
    setIsWarningOpen(false);
    setWarningMessage('');
    setPendingLinkLine(null);
  };

  return (
      
      <div className="flex flex-row w-full h-[402px]">
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
                onCodeRangeClick={onCodeRangeClick}
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
        <style jsx global>{`
          .code-link {
            background-color: #f3e8ff;
            border-bottom: 1px dashed #8b5cf6;
            padding: 0 2px;
          }
        `}</style>
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
