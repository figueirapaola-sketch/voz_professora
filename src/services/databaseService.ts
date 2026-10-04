import { Note, Student, SystemSettings, VoiceProfile } from '../types';
import { secureStorageService } from './secureStorageService';

const STORAGE_KEYS = {
  STUDENTS: '@voz_professora_students_v1',
  NOTES: '@voz_professora_notes_v1',
  VOICE_PROFILE: '@voz_professora_voice_profile_v1',
  SETTINGS: '@voz_professora_settings_v1',
  SECURE_KEY_CIPHER: '@voz_professora_sec_cipher_v1',
};

// Criptografia reversível local para garantir que a chave nunca seja salva em texto puro
function encryptLocalSecret(plain: string): string {
  if (!plain) return '';
  const salt = 0x5d;
  let enc = '';
  for (let i = 0; i < plain.length; i++) {
    enc += String.fromCharCode(plain.charCodeAt(i) ^ (salt + (i % 11)));
  }
  try {
    return 'vp_sec_' + btoa(enc);
  } catch {
    return 'vp_sec_' + enc;
  }
}

function decryptLocalSecret(cipher: string): string {
  if (!cipher || !cipher.startsWith('vp_sec_')) return '';
  const raw = cipher.replace('vp_sec_', '');
  let decoded = raw;
  try {
    decoded = atob(raw);
  } catch {
    decoded = raw;
  }
  const salt = 0x5d;
  let dec = '';
  for (let i = 0; i < decoded.length; i++) {
    dec += String.fromCharCode(decoded.charCodeAt(i) ^ (salt + (i % 11)));
  }
  return dec;
}

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
  transcriptionApiKey: '',
  transcriptionProvider: 'groq',
  customTranscriptionUrl: '',
  wakeWordSensitivity: 'media',
  offlineWakeWordEnabled: true,
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
    recordedViaVoice = true,
    audioUri?: string,
    audioDurationSeconds?: number
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
      audioUri,
      audioDurationSeconds,
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

  updateNoteText(noteId: string, newText: string): Note | null {
    const notes = this.getNotes();
    let updatedNote: Note | null = null;
    const updatedNotes = notes.map((n) => {
      if (n.id === noteId) {
        updatedNote = { ...n, text: newText.trim() };
        return updatedNote;
      }
      return n;
    });
    if (updatedNote) {
      safeSetItem(STORAGE_KEYS.NOTES, JSON.stringify(updatedNotes));
    }
    return updatedNote;
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

  // --- CONFIGURAÇÕES & ARMAZENAMENTO SEGURO ---
  getSettings(): SystemSettings {
    const raw = safeGetItem(STORAGE_KEYS.SETTINGS);
    let settings: SystemSettings = { ...DEFAULT_SETTINGS };
    if (raw) {
      try {
        settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      } catch {
        settings = { ...DEFAULT_SETTINGS };
      }
    }

    // Migração transparente de chave legada em texto puro para o armazenamento seguro
    if (settings.transcriptionApiKey && settings.transcriptionApiKey.trim()) {
      const legacyKey = settings.transcriptionApiKey.trim();
      this.saveSecureTranscriptionKey(legacyKey);
      delete settings.transcriptionApiKey;
      safeSetItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    }

    // Injeta a chave segura decifrada do banco local ou Keystore
    const secureKey = this.getSecureTranscriptionKeySync();
    return {
      ...settings,
      transcriptionApiKey: secureKey,
    };
  },

  saveSettings(settings: Partial<SystemSettings>): SystemSettings {
    const current = this.getSettings();

    // Se fornecida nova transcriptionApiKey, salva de forma segura criptografada
    if (settings.transcriptionApiKey !== undefined) {
      const cleanKey = settings.transcriptionApiKey.trim();
      this.saveSecureTranscriptionKey(cleanKey);
    }

    const secureKey = this.getSecureTranscriptionKeySync();

    // Sanitiza para NUNCA salvar a chave em texto puro no JSON do banco/localStorage
    const toPersist: Partial<SystemSettings> = { ...current, ...settings };
    const sanitizedToPersist = { ...toPersist };
    delete sanitizedToPersist.transcriptionApiKey;

    safeSetItem(STORAGE_KEYS.SETTINGS, JSON.stringify(sanitizedToPersist));

    return {
      ...toPersist,
      transcriptionApiKey: secureKey,
    } as SystemSettings;
  },

  // Operações dedicadas com a chave segura
  async getSecureTranscriptionKey(): Promise<string> {
    const syncKey = this.getSecureTranscriptionKeySync();
    if (syncKey) return syncKey;
    const fromService = await secureStorageService.getApiKey();
    if (fromService) {
      safeSetItem(STORAGE_KEYS.SECURE_KEY_CIPHER, encryptLocalSecret(fromService));
      return fromService;
    }
    return '';
  },

  getSecureTranscriptionKeySync(): string {
    const fromMemory = secureStorageService.getApiKeySync();
    if (fromMemory) return fromMemory;

    // Recupera do cofre cifrado no banco local
    const rawCipher = safeGetItem(STORAGE_KEYS.SECURE_KEY_CIPHER);
    if (rawCipher) {
      const decrypted = decryptLocalSecret(rawCipher);
      if (decrypted) {
        secureStorageService.saveApiKey(decrypted);
        return decrypted;
      }
    }

    return '';
  },

  async saveSecureTranscriptionKey(key: string): Promise<void> {
    const cleanKey = (key || '').trim();
    if (cleanKey) {
      safeSetItem(STORAGE_KEYS.SECURE_KEY_CIPHER, encryptLocalSecret(cleanKey));
      await secureStorageService.saveApiKey(cleanKey);
    } else {
      await this.deleteSecureTranscriptionKey();
      return;
    }

    // Garante que não haja resquício em texto puro
    const raw = safeGetItem(STORAGE_KEYS.SETTINGS);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.transcriptionApiKey) {
          delete parsed.transcriptionApiKey;
          safeSetItem(STORAGE_KEYS.SETTINGS, JSON.stringify(parsed));
        }
      } catch {
        // ignore
      }
    }
  },

  async deleteSecureTranscriptionKey(): Promise<void> {
    safeSetItem(STORAGE_KEYS.SECURE_KEY_CIPHER, '');
    await secureStorageService.deleteApiKey();
    const raw = safeGetItem(STORAGE_KEYS.SETTINGS);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.transcriptionApiKey) {
          delete parsed.transcriptionApiKey;
          safeSetItem(STORAGE_KEYS.SETTINGS, JSON.stringify(parsed));
        }
      } catch {
        // ignore
      }
    }
  },

  hasSecureTranscriptionKey(): boolean {
    return !!this.getSecureTranscriptionKeySync();
  },

  getMaskedTranscriptionKey(): string {
    const key = this.getSecureTranscriptionKeySync();
    return secureStorageService.maskApiKey(key);
  },

  getSecurityLabel(): string {
    return secureStorageService.getSecurityLabel();
  },
};
