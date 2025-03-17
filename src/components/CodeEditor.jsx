'use client';

import React, { useState, useRef, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { EditorView, Decoration, DecorationSet, ViewPlugin, WidgetType } from '@codemirror/view';
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
  remotePointer,
  initialContent = '',
  initialOperations = [],
  roomState = 'CREATED',
}) => {
  const [content, setContent] = useState(initialContent);
  const [operations, setOperations] = useState([]);
  const editorRef = useRef(null);
  const collaborationRef = useRef(null);
  const scrollerRef = useRef(null);

  const handleMouseMove = (event) => {
    if (!isInterviewActive || isPlaying || !event.target) return;

    const editorContainer = event.target.closest('.cm-editor');
    const editorContent = editorContainer?.querySelector('.cm-content');
    const editorScroller = editorContainer?.querySelector('.cm-scroller');
    if (!editorContainer || !editorContent || !editorScroller) return;
    
    const lineElement = event.target.closest('.cm-line');
    const contentRect = editorContent.getBoundingClientRect();
    
    const relativeX = event.clientX - contentRect.left;
    const relativeY = event.clientY - contentRect.top;

    if (relativeY < editorScroller.scrollTop + 10 || relativeX < 0 || relativeY > editorContainer.clientHeight + editorScroller.scrollTop - 20 || relativeX > contentRect.width) {
      const newPosition = {
        x: 0,
        y: 0,
        lineNumber: -1,
        scrollTop: editorScroller.scrollTop,
        timestamp: Date.now() - interviewStartTime
      };
      
      collaborationRef.current?.updateMousePointer(newPosition);
    }
    else {    
      const lineNumber = lineElement ? 
        Array.from(editorContent.querySelectorAll('.cm-line')).indexOf(lineElement) : 
        -1;
      
      const newPosition = {
        x: relativeX,
        y: relativeY,
        lineNumber,
        scrollTop: editorScroller.scrollTop,
        timestamp: Date.now() - interviewStartTime
      };
      
      collaborationRef.current?.updateMousePointer(newPosition);
    }
  };

  const handleMouseLeave = (event) => {
    if (!isInterviewActive || isPlaying || !event.target) return;

    const editorContainer = event.target.closest('.cm-editor');
    if (!editorContainer) return;
    const editorScroller = editorContainer?.querySelector('.cm-scroller');
    const newPosition = { 
      x: 0,
      y: 0,
      lineNumber: -1,
      scrollTop: editorScroller.scrollTop,
      timestamp: Date.now() - interviewStartTime
    }

    collaborationRef.current?.updateMousePointer(newPosition);
  };

  const handleChange = (value, viewUpdate) => {
    if (!isInterviewActive || isPlaying) {
      console.log("not active")
      return;
    };

    const changes = [];
    viewUpdate.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      changes.push({
        from: fromA,
        to: toA,
        text: inserted.toString(),
        timestamp: Date.now() - interviewStartTime,
        source: userId 
      });
    });

    setContent(value);
    const newOps = [...operations, ...changes];
    const newDuration = Math.max(...newOps.map(op => op.timestamp), 0);
    setOperations(newOps);
    onOperationsUpdate?.(newOps, newDuration);
  };

  const getContentAtTime = (targetTime) => {
    try {
      let result = '';
      const sortedOps = [...operations].sort((a, b) => a.timestamp - b.timestamp);
      for (const op of sortedOps) {
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

  useEffect(() => {
    if (!collaborationRef.current && roomId && userId) {
      collaborationRef.current = new CollaborationService(roomId, userId, role);
      
      collaborationRef.current.onTextUpdate((text) => {
        if (isPlaying) {
          setContent(text);
        }
      });
    }
    
    return () => {
      try {
        if (scrollerRef.current) {
          try {
            const scrollHandler = () => {};
            scrollerRef.current.removeEventListener('scroll', scrollHandler);
            scrollerRef.current = null;
          } catch (err) {
            console.error('Error removing scroll event listener:', err);
          }
        }
        
        if (collaborationRef.current) {
          try {
            collaborationRef.current.destroy();
            collaborationRef.current = null;
          } catch (err) {
            console.error('Error destroying CodeEditor collaboration service:', err);
          }
        }
      } catch (err) {
        console.error('Error during CodeEditor cleanup:', err);
      }
    };
  }, [roomId, userId, role]);

  useEffect(() => {
    if (roomState === 'ARCHIVED') {
      setOperations(initialOperations);
    } else {
      const filteredOps = initialOperations.filter(op => 
        !op.source || op.source === userId
      );
      setOperations(filteredOps);
    }
  }, [initialOperations, userId, roomState]);

  const scrollHander = (view) => {
    const currentScroll = scrollerRef.current?.scrollTop || 0;
    collaborationRef.current?.updateScrollPosition(currentScroll);
  }

  const createRemotePointersPlugin = () => {
    return ViewPlugin.fromClass(class {
      constructor(view) {
        this.decorations = this.createDecorations(view);
        scrollerRef.current = view.scrollDOM;
        scrollerRef.current?.addEventListener('scroll', () => {
          scrollHander(view);
        })
      }

      update(update) {
        if (remotePointer) {
          this.decorations = this.createDecorations(update.view);
        } else {
          this.decorations = Decoration.none;
        }
      }

      destroy() {
        scrollerRef.current?.removeEventListener('scroll', () => {
          scrollHander(view);
        });
      }

      createDecorations(view) {
        if (!remotePointer) {
          return Decoration.none;
        }

        const decorations = [];
        const remoteScroll = remotePointer?.scrollTop ?? 0;
        const currentScroll = scrollerRef.current?.scrollTop || 0;
        const scrollDiff = remoteScroll - currentScroll;
        const getBeamThickness = (diff) => {
          const absDiff = Math.abs(diff);
          const minThickness = 4;
          const maxThickness = 20;
          return Math.min(maxThickness, Math.max(minThickness, Math.floor(absDiff / 10)));
        };

        const createBeam = (isTop, thickness) => {
          return Decoration.widget({
            widget: new class extends WidgetType {
              toDOM() {
                const div = document.createElement('div');
                const editorRect = view.scrollDOM.getBoundingClientRect();
                
                div.style.position = 'fixed';
                div.style.left = editorRect.left + 'px';
                div.style.width = editorRect.width + 'px';
                div.style.height = thickness + 'px';
                
                if (isTop) {
                  div.style.top = editorRect.top + 'px';
                  div.style.background = 'linear-gradient(to bottom, #3b82f6E6 0%, transparent 100%)';
                } else {
                  div.style.bottom = (window.innerHeight - editorRect.bottom) + 'px';
                  div.style.background = 'linear-gradient(to top, #3b82f6E6 0%, transparent 100%)';
                }
                
                div.style.backgroundSize = '100% 100%';
                div.style.backgroundRepeat = 'no-repeat';
                div.style.pointerEvents = 'none';
                div.style.zIndex = '100';
                div.style.animation = 'glow 1s ease-in-out infinite alternate';

                const style = document.createElement('style');
                style.textContent = '@keyframes glow { from { opacity: 0.8; } to { opacity: 1; } }';
                div.appendChild(style);
                return div;
              }
            }
          });
        };

        if (scrollDiff < -20) {
          decorations.push(createBeam(true, getBeamThickness(scrollDiff)).range(0));
        }

        if (scrollDiff > 20) {
          decorations.push(createBeam(false, getBeamThickness(scrollDiff)).range(0));
        }

        if (remotePointer.x && remotePointer.y) {
          const pointerWidget = Decoration.widget({
            widget: new class extends WidgetType {
              toDOM() {
                const div = document.createElement('div');
                div.style.position = 'absolute';
                div.style.width = '8px';
                div.style.height = '8px';
                div.style.borderRadius = '50%';
                div.style.backgroundColor = '#3b82f6';
                div.style.opacity = '0.7';
                div.style.boxShadow = '0 0 0 2px white';
                div.style.pointerEvents = 'none';
                div.style.zIndex = '50';
                div.style.transform = 'translate(-50%, -50%)';
                div.style.left = remotePointer.x + 'px';
                div.style.top = (remotePointer.y + currentScroll) + 'px';
                return div;
              }
            }
          });
          decorations.push(pointerWidget.range(0));
        }

        return Decoration.set(decorations);
      }
    }, {
      decorations: v => v.decorations
    });
  };

  return (
    <div className="w-[500px] mx-auto p-4 border border-gray-200 rounded-lg bg-white">
      <div className="border border-gray-200 rounded-md overflow-hidden mt-4 mb-4">
        <CodeMirror
          onMouseMove={handleMouseMove}
          ref={editorRef}
          value={content}
          height='450px'
          theme="dark"
          extensions={[
            javascript(), 
            wrapStyle, 
            createRemotePointersPlugin(),
            ...(isInterviewActive && !isPlaying ? 
                (collaborationRef.current?.getExtensions() || []) : [])
          ]}
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
