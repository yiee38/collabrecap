import React, { useRef, useState, useEffect } from 'react';
import ReactQuill from 'react-quill-new';
import { QuillBinding } from 'y-quill';
import * as Y from 'yjs';
import Quill from 'quill';
import QuillCursors from 'quill-cursors';

if (typeof window !== 'undefined') {  
  Quill.register('modules/cursors', QuillCursors);
}

const QuestionEditor = ({ collaborationService }) => {
  const quillRef = useRef(null);
  const [value, setValue] = useState('');
  const bindingRef = useRef(null);

  useEffect(() => {
    if (!quillRef.current || !collaborationService) return;

    const quillEditor = quillRef.current.getEditor();
    const cursors = quillEditor.getModule('cursors');
    const ytext = collaborationService.doc.getText('questionContent');

    bindingRef.current = new QuillBinding(ytext, quillEditor);
    
    const awareness = collaborationService.provider.awareness;
    
    const cursorHandler = (range) => {
      const currentState = awareness.getLocalState();
      const newState = {
        ...currentState,
        cursors: {
          ...currentState.cursors,
          question: range ? {
            index: range.index,
            length: range.length
          } : null
        }
      };
      awareness.setLocalState(newState);
    };

    quillEditor.on('selection-change', cursorHandler);

    const awarenessHandler = () => {
      const states = awareness.getStates();
      const currentClientId = awareness.clientID;


      cursors.clearCursors();

      states.forEach((state, clientId) => {
        if (clientId !== currentClientId && state.cursors?.question) {
          const cursorColor = state.user?.color || '#000000';
          cursors.createCursor(
            clientId.toString(),
            state.user?.name || 'Anonymous',
            cursorColor
          );
          cursors.moveCursor(
            clientId.toString(),
            state.cursors.question
          );
        }
      });
    };

    awareness.on('change', awarenessHandler);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        const currentState = awareness.getLocalState();
        awareness.setLocalState({
          ...currentState,
          cursors: {
            ...currentState.cursors,
            question: null
          }
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const canEdit = collaborationService.canEdit();
    quillEditor.enable(canEdit);

    awarenessHandler();

    const currentState = awareness.getLocalState();
    if (!currentState.cursors) {
      awareness.setLocalState({
        ...currentState,
        cursors: {}
      });
    }


    return () => {
      if (bindingRef.current) {
        bindingRef.current.destroy();
      }
      const currentState = awareness.getLocalState();
      awareness.setLocalState({
        ...currentState,
        cursors: {
          ...currentState.cursors,
          question: null
        }
      });
      quillEditor.off('selection-change', cursorHandler);
      awareness.off('change', awarenessHandler);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cursors.clearCursors();
    };
  }, [collaborationService]);

  return (
    <div className="flex flex-row w-full h-[402px]">
      <div className="editor-wrapper" style={{ height: '100%' }}>
        <ReactQuill
          ref={quillRef}
          value={value || '\n'}
          onChange={setValue}
          theme="snow"
          modules={{ 
            toolbar: false,
            cursors: true,
            keyboard: {
              bindings: {
                tab: false
              }
            }
          }}
          className="h-full border border-black overflow-x-hidden break-words whitespace-pre-wrap"
        />
      </div>
    </div>
  )
};

export default QuestionEditor;
