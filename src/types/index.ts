export interface Student {
  id: string;
  name: string;
  grade?: string;
  avatarColor: string;
  notesCount: number;
  createdAt: string;
}

export type NoteCategory = 'geral' | 'pedagógico' | 'comportamento' | 'recado' | 'destaque';

export interface Note {
  id: string;
  studentId: string;
  studentName: string;
  text: string;
  category: NoteCategory;
  createdAt: string;
  recordedViaVoice: boolean;
}

export interface VoiceProfile {
  teacherName: string;
  calibrated: boolean;
  calibratedAt?: string;
  averagePitchHz: number;
  spectralCentroid: number;
  noiseFloorDb: number;
  minVoiceEnergy: number;
  noiseFilterEnabled: boolean;
  sampleAudioDataUrl?: string;
}

export type VoiceState = 
  | 'idle' 
  | 'listening_wake_word' 
  | 'recording_dictation' 
  | 'silence_countdown' 
  | 'saving';

export interface SystemSettings {
  wakeWord: string;
  silenceTimeoutSeconds: number;
  speakConfirmation: boolean;
  continuousListening: boolean;
  selectedStudentId: string | null;
}

export interface VoiceCommandDetection {
  type: 'create_folder' | 'dictate_to_student' | 'select_student' | 'save' | 'cancel' | 'unknown';
  studentName?: string;
  content?: string;
}
