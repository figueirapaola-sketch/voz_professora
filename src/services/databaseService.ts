import { Note, Student, SystemSettings, VoiceProfile } from '../types';

const STORAGE_KEYS = {
  STUDENTS: '@voz_professora_students_v1',
  NOTES: '@voz_professora_notes_v1',
  VOICE_PROFILE: '@voz_professora_voice_profile_v1',
  SETTINGS: '@voz_professora_settings_v1',
};

// Memory fallback for non-browser environments
const memoryStorage: Record<string, string> = {};

function safeGetItem(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch (e) {
    console.warn('Erro ao acessar localStorage:', e);
  }
  return memoryStorage[key] || null;
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
      return;
    }
  } catch (e) {
    console.warn('Erro ao salvar no localStorage:', e);
  }
  memoryStorage[key] = value;
}

const DEFAULT_AVATAR_COLORS = [
  '#059669', // Emerald
  '#2563eb', // Blue
  '#7c3aed', // Purple
  '#db2777', // Pink
  '#ea580c', // Orange
  '#0d9488', // Teal
  '#4f46e5', // Indigo
  '#ca8a04', // Yellow
];

const INITIAL_STUDENTS: Student[] = [
  {
    id: 'student-1',
    name: 'Ana Clara Silva',
    grade: '3º Ano Fundamental',
    avatarColor: '#059669',
    notesCount: 2,
    createdAt: new Date(Date.now() - 3600000 * 24 * 3).toISOString(),
  },
  {
    id: 'student-2',
    name: 'Lucas Pereira',
    grade: '3º Ano Fundamental',
    avatarColor: '#2563eb',
    notesCount: 1,
    createdAt: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
  },
  {
    id: 'student-3',
    name: 'Mariana Duarte',
    grade: '3º Ano Fundamental',
    avatarColor: '#7c3aed',
    notesCount: 0,
    createdAt: new Date(Date.now() - 3600000 * 24 * 1).toISOString(),
  },
];

const INITIAL_NOTES: Note[] = [
  {
    id: 'note-1',
    studentId: 'student-1',
    studentName: 'Ana Clara Silva',
    text: 'Apresentou grande facilidade com cálculos de multiplicação na aula de matemática. Ajudou os colegas no grupo.',
    category: 'pedagógico',
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    recordedViaVoice: true,
  },
  {
    id: 'note-2',
    studentId: 'student-1',
    studentName: 'Ana Clara Silva',
    text: 'Esqueceu a apostila de ciências em casa hoje. Anotado para verificar se os pais viram o recado na agenda.',
    category: 'recado',
    createdAt: new Date(Date.now() - 3600000 * 28).toISOString(),
    recordedViaVoice: false,
  },
  {
    id: 'note-3',
    studentId: 'student-2',
    studentName: 'Lucas Pereira',
    text: 'Participou ativamente da roda de leitura em voz alta. Demonstrou ótima entonação.',
    category: 'destaque',
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    recordedViaVoice: true,
  },
];

const DEFAULT_SETTINGS: SystemSettings = {
  wakeWord: 'professora',
  silenceTimeoutSeconds: 10,
  speakConfirmation: true,
  continuousListening: false,
  selectedStudentId: 'student-1',
};

const DEFAULT_VOICE_PROFILE: VoiceProfile = {
  teacherName: 'Professora',
  calibrated: false,
  averagePitchHz: 215, // Média padrão voz feminina (180 - 240Hz)
  spectralCentroid: 1400,
  noiseFloorDb: -48,
  minVoiceEnergy: 0.04,
  noiseFilterEnabled: true,
};

export const databaseService = {
  // --- ALUNOS / PASTAS ---
  getStudents(): Student[] {
    const raw = safeGetItem(STORAGE_KEYS.STUDENTS);
    if (!raw) {
      safeSetItem(STORAGE_KEYS.STUDENTS, JSON.stringify(INITIAL_STUDENTS));
      return INITIAL_STUDENTS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_STUDENTS;
    }
  },

  findStudentByName(name: string): Student | null {
    const students = this.getStudents();
    const cleanSearch = name.trim().toLowerCase();
    
    // Exact match
    const exact = students.find(s => s.name.toLowerCase() === cleanSearch);
    if (exact) return exact;

    // Partial match (first name or substring)
    const partial = students.find(s => 
      s.name.toLowerCase().includes(cleanSearch) || cleanSearch.includes(s.name.toLowerCase().split(' ')[0])
    );
    return partial || null;
  },

  createStudentFolder(name: string, grade = 'Turma Principal'): Student {
    const students = this.getStudents();
    
    // Choose random pleasant color
    const color = DEFAULT_AVATAR_COLORS[students.length % DEFAULT_AVATAR_COLORS.length];
    
    const newStudent: Student = {
      id: 'student-' + Date.now(),
      name: name.trim(),
      grade: grade.trim(),
      avatarColor: color,
      notesCount: 0,
      createdAt: new Date().toISOString(),
    };

    const updated = [newStudent, ...students];
    safeSetItem(STORAGE_KEYS.STUDENTS, JSON.stringify(updated));
    return newStudent;
  },

  deleteStudentFolder(studentId: string): void {
    const students = this.getStudents().filter(s => s.id !== studentId);
    safeSetItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));

    // Also delete notes for this student
    const notes = this.getNotes().filter(n => n.studentId !== studentId);
    safeSetItem(STORAGE_KEYS.NOTES, JSON.stringify(notes));
  },

  // --- ANOTAÇÕES ---
  getNotes(studentId?: string): Note[] {
    const raw = safeGetItem(STORAGE_KEYS.NOTES);
    let notes: Note[] = [];
    if (!raw) {
      safeSetItem(STORAGE_KEYS.NOTES, JSON.stringify(INITIAL_NOTES));
      notes = INITIAL_NOTES;
    } else {
      try {
        notes = JSON.parse(raw);
      } catch {
        notes = INITIAL_NOTES;
      }
    }

    if (studentId) {
      return notes.filter(n => n.studentId === studentId);
    }
    return notes;
  },

  addNote(
    studentId: string, 
    studentName: string, 
    text: string, 
    category: Note['category'] = 'geral',
    recordedViaVoice = true
  ): Note {
    const notes = this.getNotes();
    const newNote: Note = {
      id: 'note-' + Date.now(),
      studentId,
      studentName,
      text: text.trim(),
      category,
      createdAt: new Date().toISOString(),
      recordedViaVoice,
    };

    const updatedNotes = [newNote, ...notes];
    safeSetItem(STORAGE_KEYS.NOTES, JSON.stringify(updatedNotes));

    // Update student's notesCount
    const students = this.getStudents().map(s => {
      if (s.id === studentId) {
        return { ...s, notesCount: (s.notesCount || 0) + 1 };
      }
      return s;
    });
    safeSetItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));

    return newNote;
  },

  deleteNote(noteId: string): void {
    const notes = this.getNotes();
    const target = notes.find(n => n.id === noteId);
    const updated = notes.filter(n => n.id !== noteId);
    safeSetItem(STORAGE_KEYS.NOTES, JSON.stringify(updated));

    if (target) {
      const students = this.getStudents().map(s => {
        if (s.id === target.studentId) {
          return { ...s, notesCount: Math.max(0, (s.notesCount || 1) - 1) };
        }
        return s;
      });
      safeSetItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));
    }
  },

  // --- PERFIL DE VOZ DA PROFESSORA ---
  getVoiceProfile(): VoiceProfile {
    const raw = safeGetItem(STORAGE_KEYS.VOICE_PROFILE);
    if (!raw) return DEFAULT_VOICE_PROFILE;
    try {
      return { ...DEFAULT_VOICE_PROFILE, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_VOICE_PROFILE;
    }
  },

  saveVoiceProfile(profile: VoiceProfile): void {
    safeSetItem(STORAGE_KEYS.VOICE_PROFILE, JSON.stringify(profile));
  },

  // --- CONFIGURAÇÕES ---
  getSettings(): SystemSettings {
    const raw = safeGetItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings: Partial<SystemSettings>): SystemSettings {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    safeSetItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
    return updated;
  },
};
