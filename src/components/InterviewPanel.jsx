import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import NotePad from "./NotepadTab"
import QuestionEditor from "./QuestionEditor"

const InterviewerPanel = ({ startTimeRef, roomState, endTimeRef, notepadRef, handleTimestampClick, currentTime, archivedNotes, archivedNoteLines, handleSeek, handleLiveUpdate, collaborationService }) => {

  return (
    <div className="flex flex-col gap-3 overflow-hidden">
      <Tabs defaultValue="question" className="border w-[500px] border-gray-200 rounded-lg px-8 py-8 " >
        <TabsList>
          <TabsTrigger value="question">Question</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
        <TabsContent value="question">
          <QuestionEditor collaborationService={collaborationService} />
        </TabsContent>
        <TabsContent value="notes">
          <NotePad 
            baseTimeRef={startTimeRef}
            roomState={roomState}
            endTimeRef={endTimeRef}
            ref={notepadRef}
            onTimestampClick={handleTimestampClick}
            currentTime={currentTime}
            initialContent={archivedNotes}
            initialNoteLines={archivedNoteLines}
            onSeek={handleSeek}
            onLiveUpdate={handleLiveUpdate}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default InterviewerPanel;