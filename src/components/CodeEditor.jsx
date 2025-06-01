'use client';

import React, { useState, useRef, useEffect, useImperativeHandle, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { EditorView, Decoration, DecorationSet, ViewPlugin, WidgetType } from '@codemirror/view';
import { StateField, StateEffect, EditorState } from '@codemirror/state';
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

const setHighlightRange = StateEffect.define();
const clearHighlightRange = StateEffect.define();

const highlightRangeField = StateField.define({
  create() {
    return null; 
  },
  update(range, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlightRange)) {
        return effect.value; // { from, to }
      } else if (effect.is(clearHighlightRange)) {
        return null;
      }
    }
    return range;
  }
});

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
  onSelectionChange = () => {},
  highlightRange = null,
}, ref) => {
  const [content, setContent] = useState(initialContent);
  const [operations, setOperations] = useState([]);
  const editorRef = useRef(null);
  const [editorView, setEditorView] = useState(null);
  const collaborationRef = useRef(null);
  const scrollerRef = useRef(null);
  const [currentSelection, setCurrentSelection] = useState(null);
  const [preservedHighlight, setPreservedHighlight] = useState(null);
  const [selectedRange, setSelectedRange] = useState(null);

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

  useImperativeHandle(ref, () => ({
    highlightRange: (range) => {
      if (editorView && range && typeof range.from === 'number' && typeof range.to === 'number') {
        editorView.dispatch({
          effects: setHighlightRange.of(range)
        });
        
        const line = editorView.state.doc.lineAt(range.from);
        editorView.dispatch({
          effects: EditorView.scrollIntoView(line.from, {y: 'center'})
        });
      }
    },
    
    clearHighlight: () => {
      if (editorView) {
        editorView.dispatch({
          effects: clearHighlightRange.of()
        });
      }
    },

    getCurrentContent: () => {
      return content;
    }
  }));
  


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

  const handleSelectionChange = useCallback((range) => {
    console.log("CodeEditor: Selection changed:", range);
    setSelectedRange(range);
  }, []);

  useEffect(() => {
    if (!editorView) return;
    
    const handleInternalSelectionChange = () => {
      try {
        if (!editorView) return;
        
        const selection = editorView.state.selection.main;
        
        if (selection.from !== selection.to) {
          const range = { from: selection.from, to: selection.to };
          
          const selectedText = editorView.state.doc.sliceString(range.from, range.to);
          const selectionWithText = { ...range, text: selectedText };
          
          setCurrentSelection(selectionWithText);
          onSelectionChange(selectionWithText);
        } else {
          setCurrentSelection(null);
          onSelectionChange(null);
        }
      } catch (error) {
        console.error("Error in selection change handler:", error);
      }
    };
    
    const selectionListener = EditorView.updateListener.of(update => {
      if (update.selectionSet) {
        handleInternalSelectionChange();
      }
    });
    
    editorView.dispatch({
      effects: StateEffect.appendConfig.of([selectionListener])
    });
    
    const editorElement = editorView.dom;
    
    const handleMouseUp = () => {
      setTimeout(() => {
        handleInternalSelectionChange();
      }, 10);
    };
    
    const handleKeyUp = (e) => {
      if (e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || 
          e.key === 'ArrowUp' || e.key === 'ArrowDown' || 
          e.ctrlKey || e.metaKey) {
        setTimeout(() => {
          handleInternalSelectionChange();
        }, 10);
      }
    };
    
    editorElement.addEventListener('mouseup', handleMouseUp);
    editorElement.addEventListener('keyup', handleKeyUp);
    
    return () => {
      setCurrentSelection(null);
      if (editorElement) {
        editorElement.removeEventListener('mouseup', handleMouseUp);
        editorElement.removeEventListener('keyup', handleKeyUp);
      }
    };
  }, [editorView, onSelectionChange]);

  useEffect(() => {
    if (!editorView) return;

    try {
      if (highlightRange === null || highlightRange === undefined) {
        setPreservedHighlight(null);
        editorView.dispatch({
          effects: clearHighlightRange.of()
        });
        return;
      }
      
      const docLength = editorView.state.doc.length;
      
      if (highlightRange && 
          typeof highlightRange.from === 'number' && 
          typeof highlightRange.to === 'number' &&
          highlightRange.from >= 0 && 
          highlightRange.to >= highlightRange.from && 
          highlightRange.from < docLength) {
        
        const safeToPosition = Math.min(highlightRange.to, docLength);
        const safeRange = {
          from: highlightRange.from,
          to: safeToPosition
        };
        
        setPreservedHighlight(safeRange);
        
        editorView.dispatch({
          effects: setHighlightRange.of(safeRange)
        });
        
        try {
          if (docLength > 0) {
            const line = editorView.state.doc.lineAt(highlightRange.from);
            editorView.dispatch({
              effects: EditorView.scrollIntoView(line.from, {y: 'center'})
            });
          }
        } catch (scrollError) {
          console.error("Error scrolling to highlight:", scrollError);
        }
      } else {
        setPreservedHighlight(null);
        editorView.dispatch({
          effects: clearHighlightRange.of()
        });
      }
    } catch (error) {
      console.error("Error in highlight useEffect:", error);
      try {
        setPreservedHighlight(null);
        editorView.dispatch({
          effects: clearHighlightRange.of()
        });
      } catch (clearError) {
        console.error("Error clearing highlight:", clearError);
      }
    }
  }, [highlightRange, editorView]);

  useEffect(() => {
    if (editorView && preservedHighlight) {
      try {
        console.log("Restoring preserved highlight:", preservedHighlight);
        editorView.dispatch({
          effects: setHighlightRange.of(preservedHighlight)
        });
      } catch (error) {
        console.error("Error restoring preserved highlight:", error);
      }
    }
  }, [editorView, preservedHighlight]);

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

  const createRangeHighlightPlugin = () => {
    return ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = this.createDecorations(view);
        }

        update(update) {
          if (update.docChanged || 
              update.viewportChanged || 
              update.selectionSet || 
              update.transactions.some(tr => 
                tr.effects.some(e => 
                  e.is(setHighlightRange) || 
                  e.is(clearHighlightRange)
                )
              )) {
            this.decorations = this.createDecorations(update.view);
          }
        }

        createDecorations(view) {
          const highlightRange = view.state.field(highlightRangeField);
          
          if (!highlightRange) return Decoration.none;

          const decorations = [];

          decorations.push(
            Decoration.mark({
              class: "cm-highlighted-range",
            }).range(highlightRange.from, highlightRange.to)
          );

          return Decoration.set(decorations);
        }
      },
      {
        decorations: v => v.decorations
      }
    );
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
            highlightRangeField, 
            createRangeHighlightPlugin(),
            createRemotePointersPlugin(),
            EditorView.theme({
              ".cm-highlighted-range": {
                backgroundColor: "#f3e8ff",
                border: "1px solid #c084fc"
              },
              ".cm-content": {
                userSelect: "text !important"
              },
              ".cm-editor": {
                userSelect: "text !important"
              }
            }),
            ...(collaborationRef.current?.getExtensions() || [])
          ]}
          onChange={handleChange}
          onCreateEditor={(view) => {
            setEditorView(view);
    
            view.dispatch({
              effects: clearHighlightRange.of()
            });
          }}
          editable={isInterviewActive && !isPlaying}
          basicSetup={{
            lineNumbers: true,
            indentOnInput: true,
            syntaxHighlighting: true,
            closeBrackets: true,
            defaultKeymap: true,
            historyKeymap: true,
            allowMultipleSelections: false,
            searchKeymap: true,
          }}
          style={{ overflow: 'scroll' }}
        />
      </div>
    </div>
  );
};

export default CodeEditor;
