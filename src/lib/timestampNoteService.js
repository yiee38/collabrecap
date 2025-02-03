export class TimestampNoteService {
  constructor() {
    this.doc = new Y.Doc();
    this.yText = this.doc.getText('notepad');
    this.timestamps = new Map();
    this.undoManager = new Y.UndoManager(this.yText);
    
    this.extensions = [
      yCollab(this.yText, null),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          this.undoManager.stopCapturing();
        }
      })
    ];
  }

  addTimestamp(lineNumber, time) {
    this.timestamps.set(lineNumber, time);
  }

  removeTimestamp(lineNumber) {
    this.timestamps.delete(lineNumber);
  }

  getTimestamp(lineNumber) {
    return this.timestamps.get(lineNumber);
  }

  getAllTimestamps() {
    return Array.from(this.timestamps.entries());
  }

  getText() {
    return this.yText.toString();
  }

  getExtensions() {
    return this.extensions;
  }

  destroy() {
    this.doc.destroy();
  }
}