import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { Note, Student, SystemSettings, VoiceProfile } from '../types';
import { secureStorageService } from './secureStorageService';

const STORAGE_KEYS = {
  STUDENTS: '@voz_professora_students_v1',
  NOTES: '@voz_professora_notes_v1',
  VOICE_PROFILE: '@voz_professora_voice_profile_v1',
  SETTINGS: '@voz_professora_settings_v1',
  SECURE_KEY_CIPHER: '@voz_professora_sec_cipher_v1',
  SQLITE_MIGRATED: '@voz_professora_sqlite_migrated_v1',
};

const SQLITE_DB_NAME = 'voz_professora.db';

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

// Memory fallback for non-browser / synchronous access before AsyncStorage finishes hydrating
const memoryStorage: Record<string, string> = {};

function safeGetItem(key: string): string | null {
  if (memoryStorage[key] !== undefined) {
    return memoryStorage[key];
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(key);
      if (val !== null) {
        memoryStorage[key] = val;
        return val;
      }
    }
  } catch (e) {
    console.warn('Erro ao acessar localStorage:', e);
  }
  return memoryStorage[key] || null;
}

function safeSetItem(key: string, value: string): void {
  memoryStorage[key] = value;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch (e) {
    console.warn('Erro ao salvar no localStorage:', e);
  }
  // Persiste assincronamente no @react-native-async-storage/async-storage (Android, iOS e Web)
  AsyncStorage.setItem(key, value).catch((err) => {
    console.warn('[AsyncStorage] Erro ao persistir chave:', key, err);
  });
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
  wakeWord: 'todas',
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

// ============================================================================
// GERENCIAMENTO DO BANCO RELACIONAL LOCAL (EXPO-SQLITE) E CACHE EM MEMÓRIA
// ============================================================================
let sqliteDb: SQLite.SQLiteDatabase | null = null;
let isStorageInitialized = false;
let initPromise: Promise<void> | null = null;
let cachedStudents: Student[] | null = null;
let cachedNotes: Note[] | null = null;

interface StudentRow {
  id: string;
  name: string;
  grade: string | null;
  avatarColor: string;
  notesCount: number;
  createdAt: string;
}

interface NoteRow {
  id: string;
  studentId: string;
  studentName: string;
  text: string;
  category: string;
  createdAt: string;
  recordedViaVoice: number;
  audioUri: string | null;
  audioDurationSeconds: number | null;
}

function mapRowToStudent(row: StudentRow): Student {
  return {
    id: row.id,
    name: row.name,
    grade: row.grade || 'Turma Principal',
    avatarColor: row.avatarColor || '#059669',
    notesCount: Number(row.notesCount || 0),
    createdAt: row.createdAt,
  };
}

function mapRowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    studentId: row.studentId,
    studentName: row.studentName,
    text: row.text,
    category: (row.category as Note['category']) || 'geral',
    createdAt: row.createdAt,
    recordedViaVoice: Boolean(row.recordedViaVoice),
    audioUri: row.audioUri || undefined,
    audioDurationSeconds:
      row.audioDurationSeconds !== null && row.audioDurationSeconds !== undefined
        ? Number(row.audioDurationSeconds)
        : undefined,
  };
}

/**
 * Inicializa o banco SQLite de forma síncrona quando suportado (Android / iOS)
 * para disponibilidade imediata desde o primeiro frame.
 */
function ensureSyncSQLiteReady(): SQLite.SQLiteDatabase | null {
  if (sqliteDb) return sqliteDb;
  if (Platform.OS === 'web') return null;

  try {
    const db = SQLite.openDatabaseSync(SQLITE_DB_NAME);
    db.execSync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        grade TEXT,
        avatarColor TEXT NOT NULL,
        notesCount INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY NOT NULL,
        studentId TEXT NOT NULL,
        studentName TEXT NOT NULL,
        text TEXT NOT NULL,
        category TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        recordedViaVoice INTEGER NOT NULL DEFAULT 1,
        audioUri TEXT,
        audioDurationSeconds REAL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_studentId ON notes(studentId);
    `);
    sqliteDb = db;
    return db;
  } catch (err) {
    console.warn('[SQLite] Falha na inicialização síncrona, usando fallback:', err);
    return null;
  }
}

export const databaseService = {
  /**
   * Inicializa e hidrata o armazenamento local do dispositivo:
   * - `@react-native-async-storage/async-storage`: Preferências, configurações, perfil de voz e chaves.
   * - `expo-sqlite`: Banco relacional local para pastas de alunos (`students`) e anotações (`notes`).
   */
  async init(): Promise<void> {
    if (isStorageInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        // 1. Hidrata chaves-valor do AsyncStorage para o cache rápido em memória
        const keysToLoad = [
          STORAGE_KEYS.SETTINGS,
          STORAGE_KEYS.VOICE_PROFILE,
          STORAGE_KEYS.SECURE_KEY_CIPHER,
          STORAGE_KEYS.STUDENTS,
          STORAGE_KEYS.NOTES,
          STORAGE_KEYS.SQLITE_MIGRATED,
        ];
        const pairs = await AsyncStorage.multiGet(keysToLoad);
        for (const [key, value] of pairs) {
          if (value !== null) {
            memoryStorage[key] = value;
          }
        }

        // Inicializa o cofre seguro da chave de API
        await secureStorageService.init();

        // 2. Abre e configura o banco de dados relacional SQLite (expo-sqlite)
        if (!sqliteDb) {
          try {
            const db = await SQLite.openDatabaseAsync(SQLITE_DB_NAME);
            await db.execAsync(`
              CREATE TABLE IF NOT EXISTS students (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                grade TEXT,
                avatarColor TEXT NOT NULL,
                notesCount INTEGER NOT NULL DEFAULT 0,
                createdAt TEXT NOT NULL
              );
              CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY NOT NULL,
                studentId TEXT NOT NULL,
                studentName TEXT NOT NULL,
                text TEXT NOT NULL,
                category TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                recordedViaVoice INTEGER NOT NULL DEFAULT 1,
                audioUri TEXT,
                audioDurationSeconds REAL
              );
              CREATE INDEX IF NOT EXISTS idx_notes_studentId ON notes(studentId);
            `);
            sqliteDb = db;
          } catch (sqliteErr) {
            console.warn('[SQLite] openDatabaseAsync indisponível neste ambiente, usando AsyncStorage:', sqliteErr);
          }
        }

        // 3. Verifica e popula/migra dados iniciais para o SQLite
        if (sqliteDb) {
          const existingStudents = await sqliteDb.getAllAsync<StudentRow>(
            'SELECT * FROM students ORDER BY createdAt DESC'
          );

          if (existingStudents.length === 0) {
            // Verifica se já existiam dados no AsyncStorage / localStorage para migrar
            let seedStudents = INITIAL_STUDENTS;
            let seedNotes = INITIAL_NOTES;

            const legacyStudentsRaw = safeGetItem(STORAGE_KEYS.STUDENTS);
            const legacyNotesRaw = safeGetItem(STORAGE_KEYS.NOTES);

            if (legacyStudentsRaw) {
              try {
                const parsed = JSON.parse(legacyStudentsRaw);
                if (Array.isArray(parsed) && parsed.length > 0) seedStudents = parsed;
              } catch {
                // ignore
              }
            }

            if (legacyNotesRaw) {
              try {
                const parsed = JSON.parse(legacyNotesRaw);
                if (Array.isArray(parsed) && parsed.length > 0) seedNotes = parsed;
              } catch {
                // ignore
              }
            }

            for (const st of seedStudents) {
              await sqliteDb.runAsync(
                `INSERT OR REPLACE INTO students (id, name, grade, avatarColor, notesCount, createdAt)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                st.id,
                st.name,
                st.grade || 'Turma Principal',
                st.avatarColor || '#059669',
                st.notesCount || 0,
                st.createdAt
              );
            }

            for (const nt of seedNotes) {
              await sqliteDb.runAsync(
                `INSERT OR REPLACE INTO notes (id, studentId, studentName, text, category, createdAt, recordedViaVoice, audioUri, audioDurationSeconds)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                nt.id,
                nt.studentId,
                nt.studentName,
                nt.text,
                nt.category || 'geral',
                nt.createdAt,
                nt.recordedViaVoice ? 1 : 0,
                nt.audioUri ?? null,
                nt.audioDurationSeconds ?? null
              );
            }

            safeSetItem(STORAGE_KEYS.SQLITE_MIGRATED, 'true');
          }

          const finalStudents = await sqliteDb.getAllAsync<StudentRow>(
            'SELECT * FROM students ORDER BY createdAt DESC'
          );
          const finalNotes = await sqliteDb.getAllAsync<NoteRow>(
            'SELECT * FROM notes ORDER BY createdAt DESC'
          );

          cachedStudents = finalStudents.map(mapRowToStudent);
          cachedNotes = finalNotes.map(mapRowToNote);

          // Mantém espelho atualizado no AsyncStorage para redundância offline
          safeSetItem(STORAGE_KEYS.STUDENTS, JSON.stringify(cachedStudents));
          safeSetItem(STORAGE_KEYS.NOTES, JSON.stringify(cachedNotes));
        } else {
          // Fallback caso WebAssembly do SQLite não esteja ativo no navegador
          cachedStudents = this.getStudents();
          cachedNotes = this.getNotes();
        }
      } catch (e) {
        console.warn('[DatabaseService] Erro ao inicializar armazenamento local:', e);
      } finally {
        isStorageInitialized = true;
      }
    })();

    return initPromise;
  },

  /**
   * Retorna informações diagnósticas sobre os motores de armazenamento local ativos.
   */
  getLocalStorageEnginesInfo(): {
    relationalDb: string;
    keyValueStorage: string;
    secureHardware: string;
  } {
    return {
      relationalDb: sqliteDb
        ? 'Expo SQLite (voz_professora.db • Tabelas: students, notes)'
        : 'AsyncStorage Fallback Relacional',
      keyValueStorage: '@react-native-async-storage/async-storage (Preferências & Perfil)',
      secureHardware: secureStorageService.getSecurityLabel(),
    };
  },

  // --- ALUNOS / PASTAS (EXPO-SQLITE + ASYNCSTORAGE) ---
  getStudents(): Student[] {
    if (cachedStudents) {
      return cachedStudents;
    }

    const db = ensureSyncSQLiteReady();
    if (db) {
      try {
        const rows = db.getAllSync<StudentRow>('SELECT * FROM students ORDER BY createdAt DESC');
        if (rows.length > 0) {
          cachedStudents = rows.map(mapRowToStudent);
          return cachedStudents;
        }
      } catch (e) {
        console.warn('[SQLite] Erro ao ler alunos sincronamente:', e);
      }
    }

    const raw = safeGetItem(STORAGE_KEYS.STUDENTS);
    if (!raw) {
      cachedStudents = INITIAL_STUDENTS;
      safeSetItem(STORAGE_KEYS.STUDENTS, JSON.stringify(INITIAL_STUDENTS));
      if (db) {
        try {
          for (const st of INITIAL_STUDENTS) {
            db.runSync(
              `INSERT OR REPLACE INTO students (id, name, grade, avatarColor, notesCount, createdAt)
               VALUES (?, ?, ?, ?, ?, ?)`,
              st.id,
              st.name,
              st.grade || 'Turma Principal',
              st.avatarColor || '#059669',
              st.notesCount || 0,
              st.createdAt
            );
          }
        } catch {
          // ignore
        }
      }
      return INITIAL_STUDENTS;
    }
    try {
      cachedStudents = JSON.parse(raw);
      return cachedStudents || INITIAL_STUDENTS;
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
    cachedStudents = updated;
    safeSetItem(STORAGE_KEYS.STUDENTS, JSON.stringify(updated));

    // Persiste no banco relacional local (expo-sqlite)
    const db = ensureSyncSQLiteReady();
    if (db) {
      db.runAsync(
        `INSERT OR REPLACE INTO students (id, name, grade, avatarColor, notesCount, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        newStudent.id,
        newStudent.name,
        newStudent.grade || 'Turma Principal',
        newStudent.avatarColor,
        newStudent.notesCount,
        newStudent.createdAt
      ).catch((err) => console.warn('[SQLite] Erro ao inserir aluno:', err));
    }

    return newStudent;
  },

  deleteStudentFolder(studentId: string): void {
    const students = this.getStudents().filter(s => s.id !== studentId);
    cachedStudents = students;
    safeSetItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));

    // Also delete notes for this student
    const notes = this.getNotes().filter(n => n.studentId !== studentId);
    cachedNotes = notes;
    safeSetItem(STORAGE_KEYS.NOTES, JSON.stringify(notes));

    // Remove do banco relacional local (expo-sqlite)
    const db = ensureSyncSQLiteReady();
    if (db) {
      db.runAsync('DELETE FROM students WHERE id = ?', studentId).catch((err) =>
        console.warn('[SQLite] Erro ao excluir aluno:', err)
      );
      db.runAsync('DELETE FROM notes WHERE studentId = ?', studentId).catch((err) =>
        console.warn('[SQLite] Erro ao excluir notas do aluno:', err)
      );
    }
  },

  // --- ANOTAÇÕES (EXPO-SQLITE + ASYNCSTORAGE) ---
  getNotes(studentId?: string): Note[] {
    let notes: Note[];

    if (cachedNotes) {
      notes = cachedNotes;
    } else {
      const db = ensureSyncSQLiteReady();
      let loadedFromDb: Note[] | null = null;
      if (db) {
        try {
          const rows = db.getAllSync<NoteRow>('SELECT * FROM notes ORDER BY createdAt DESC');
          if (rows.length > 0) {
            loadedFromDb = rows.map(mapRowToNote);
          }
        } catch (e) {
          console.warn('[SQLite] Erro ao ler notas sincronamente:', e);
        }
      }

      if (loadedFromDb) {
        notes = loadedFromDb;
        cachedNotes = notes;
      } else {
        const raw = safeGetItem(STORAGE_KEYS.NOTES);
        if (!raw) {
          safeSetItem(STORAGE_KEYS.NOTES, JSON.stringify(INITIAL_NOTES));
          notes = INITIAL_NOTES;
          if (db) {
            try {
              for (const nt of INITIAL_NOTES) {
                db.runSync(
                  `INSERT OR REPLACE INTO notes (id, studentId, studentName, text, category, createdAt, recordedViaVoice, audioUri, audioDurationSeconds)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  nt.id,
                  nt.studentId,
                  nt.studentName,
                  nt.text,
                  nt.category || 'geral',
                  nt.createdAt,
                  nt.recordedViaVoice ? 1 : 0,
                  nt.audioUri ?? null,
                  nt.audioDurationSeconds ?? null
                );
              }
            } catch {
              // ignore
            }
          }
        } else {
          try {
            notes = JSON.parse(raw);
          } catch {
            notes = INITIAL_NOTES;
          }
        }
        cachedNotes = notes;
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
    cachedNotes = updatedNotes;
    safeSetItem(STORAGE_KEYS.NOTES, JSON.stringify(updatedNotes));

    // Update student's notesCount
    let updatedCount = 1;
    const students = this.getStudents().map(s => {
      if (s.id === studentId) {
        updatedCount = (s.notesCount || 0) + 1;
        return { ...s, notesCount: updatedCount };
      }
      return s;
    });
    cachedStudents = students;
    safeSetItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));

    // Salva no banco relacional local (expo-sqlite)
    const db = ensureSyncSQLiteReady();
    if (db) {
      db.runAsync(
        `INSERT OR REPLACE INTO notes (id, studentId, studentName, text, category, createdAt, recordedViaVoice, audioUri, audioDurationSeconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newNote.id,
        newNote.studentId,
        newNote.studentName,
        newNote.text,
        newNote.category,
        newNote.createdAt,
        newNote.recordedViaVoice ? 1 : 0,
        newNote.audioUri ?? null,
        newNote.audioDurationSeconds ?? null
      ).catch((err) => console.warn('[SQLite] Erro ao inserir anotação:', err));

      db.runAsync(
        'UPDATE students SET notesCount = ? WHERE id = ?',
        updatedCount,
        studentId
      ).catch((err) => console.warn('[SQLite] Erro ao atualizar contador de notas do aluno:', err));
    }

    return newNote;
  },

  deleteNote(noteId: string): void {
    const notes = this.getNotes();
    const target = notes.find(n => n.id === noteId);
    const updated = notes.filter(n => n.id !== noteId);
    cachedNotes = updated;
    safeSetItem(STORAGE_KEYS.NOTES, JSON.stringify(updated));

    let newCount = 0;
    if (target) {
      const students = this.getStudents().map(s => {
        if (s.id === target.studentId) {
          newCount = Math.max(0, (s.notesCount || 1) - 1);
          return { ...s, notesCount: newCount };
        }
        return s;
      });
      cachedStudents = students;
      safeSetItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));
    }

    // Remove do banco relacional local (expo-sqlite)
    const db = ensureSyncSQLiteReady();
    if (db) {
      db.runAsync('DELETE FROM notes WHERE id = ?', noteId).catch((err) =>
        console.warn('[SQLite] Erro ao deletar anotação:', err)
      );
      if (target) {
        db.runAsync(
          'UPDATE students SET notesCount = ? WHERE id = ?',
          newCount,
          target.studentId
        ).catch((err) => console.warn('[SQLite] Erro ao atualizar contador após exclusão:', err));
      }
    }
  },

  updateNoteText(noteId: string, newText: string): Note | null {
    const notes = this.getNotes();
    let updatedNote: Note | null = null;
    const cleanText = newText.trim();
    const updatedNotes = notes.map((n) => {
      if (n.id === noteId) {
        updatedNote = { ...n, text: cleanText };
        return updatedNote;
      }
      return n;
    });
    if (updatedNote) {
      cachedNotes = updatedNotes;
      safeSetItem(STORAGE_KEYS.NOTES, JSON.stringify(updatedNotes));

      const db = ensureSyncSQLiteReady();
      if (db) {
        db.runAsync('UPDATE notes SET text = ? WHERE id = ?', cleanText, noteId).catch((err) =>
          console.warn('[SQLite] Erro ao atualizar texto da anotação:', err)
        );
      }
    }
    return updatedNote;
  },

  // --- PERFIL DE VOZ DA PROFESSORA (ASYNCSTORAGE) ---
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

  // --- CONFIGURAÇÕES & ARMAZENAMENTO SEGURO (ASYNCSTORAGE + SECURESTORE) ---
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

    // Sanitiza para NUNCA salvar a chave em texto puro no JSON do AsyncStorage/localStorage
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
