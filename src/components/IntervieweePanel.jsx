import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import QuestionEditor from "./QuestionEditor"
import NotePad from "./NotepadTab"
import { Lock } from 'lucide-react'
import { toast } from "@/hooks/use-toast"

const IntervieweePanel = ({ 
  collaborationService, 
  activeTab, 
  onTabChange,
  roomState,
  startTimeRef,
  endTimeRef,
  notepadRef,
  handleTimestampClick,
  currentTime,
  archivedNotes,
  archivedNoteLines,
  handleSeek,
  handleLiveUpdate,
  onCodeRangeClick
}) => {
  
  const isNotesAvailable = roomState === 'ARCHIVED';
  
  const handleNotesTabClick = (e) => {
    if (!isNotesAvailable) {
      e.preventDefault();
      e.stopPropagation();
      toast({
        title: "Notes Access",
        description: "Notepad will be available for you after the interview",
        duration: 3000,
      });
    }
  };

  const handleTabChange = (value) => {
    if (value === 'question' || (value === 'notes' && isNotesAvailable)) {
      onTabChange(value);
    }
  };

  return (
    <div className="flex flex-col gap-3 overflow-hidden">
      <Tabs 
        defaultValue="question" 
        className="border w-[500px] border-gray-200 rounded-lg px-8 py-8" 
        onValueChange={handleTabChange}
        value={activeTab}
      >
        <TabsList>
          <TabsTrigger value="question">Question</TabsTrigger>
          <TabsTrigger 
            value="notes" 
            className={`relative transition-opacity ${
              isNotesAvailable 
                ? 'cursor-pointer hover:opacity-90' 
                : 'cursor-pointer opacity-50 hover:opacity-70'
            }`}
            title={isNotesAvailable ? "Take notes and link with code" : "Notes will be available after the interview"}
            onClick={handleNotesTabClick}
          >
            <div className="flex items-center gap-1">
              <span>Notes</span>
              {!isNotesAvailable && <Lock size={12} className="text-gray-400" />}
            </div>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="question">
          <div className="w-full h-[450px]">
            <QuestionEditor collaborationService={collaborationService} />
          </div>
        </TabsContent>
        <TabsContent value="notes">
          {isNotesAvailable ? (
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
              onCodeRangeClick={onCodeRangeClick}
              userRole="interviewee"
            />
          ) : (
            <div className="w-full h-[450px] flex items-center justify-center text-gray-500">
              <div className="text-center">
                <Lock size={24} className="mx-auto mb-2 text-gray-400" />
                <p>Notes will be available after the interview</p>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default IntervieweePanel; 