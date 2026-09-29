import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Note, NoteCategory, Student } from '../types';
import { nativeAudioService } from '../services/nativeAudioService';

interface StudentDetailsModalProps {
  visible: boolean;
  student: Student | null;
  notes: Note[];
  onClose: () => void;
  onAddNote: (studentId: string, studentName: string, text: string, category: NoteCategory) => void;
  onDeleteNote: (noteId: string) => void;
  onDeleteStudent: (studentId: string) => void;
  onStartVoiceForStudent: (student: Student) => void;
}

const CATEGORIES: { label: string; value: NoteCategory; color: string }[] = [
  { label: 'Geral', value: 'geral', color: '#64748b' },
  { label: 'Pedagógico', value: 'pedagógico', color: '#2563eb' },
  { label: 'Comportamento', value: 'comportamento', color: '#ea580c' },
  { label: 'Recado', value: 'recado', color: '#7c3aed' },
  { label: 'Destaque', value: 'destaque', color: '#15803d' },
];

export const StudentDetailsModal: React.FC<StudentDetailsModalProps> = ({
  visible,
  student,
  notes,
  onClose,
  onAddNote,
  onDeleteNote,
  onDeleteStudent,
  onStartVoiceForStudent,
}) => {
  const [newNoteText, setNewNoteText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<NoteCategory>('pedagógico');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [playingNoteId, setPlayingNoteId] = useState<string | null>(null);

  if (!student) return null;

  const handleSaveNote = () => {
    if (!newNoteText.trim()) return;
    onAddNote(student.id, student.name, newNoteText.trim(), selectedCategory);
    setNewNoteText('');
    setIsAddingNote(false);
  };

  const handleExportNotes = () => {
    const header = `📋 RELATÓRIO DO ALUNO: ${student.name} (${student.grade || 'Geral'})\nData: ${new Date().toLocaleDateString('pt-BR')}\n----------------------------------------\n\n`;
    const body = notes
      .map(
        (n, i) =>
          `${i + 1}. [${n.category.toUpperCase()}] - ${new Date(n.createdAt).toLocaleDateString('pt-BR')} ${new Date(n.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}\n${n.text}\n`
      )
      .join('\n');

    const fullText = header + (notes.length === 0 ? 'Nenhuma anotação cadastrada.' : body);

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(fullText);
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 2500);
    } else {
      Alert.alert('Relatório', 'Texto copiado com sucesso.');
    }
  };

  const handleModalClose = async () => {
    await nativeAudioService.stopPlayback();
    setPlayingNoteId(null);
    onClose();
  };

  const handleTogglePlayAudio = async (noteId: string, audioUri: string) => {
    if (playingNoteId === noteId) {
      await nativeAudioService.stopPlayback();
      setPlayingNoteId(null);
    } else {
      try {
        setPlayingNoteId(noteId);
        await nativeAudioService.playAudio(audioUri, () => {
          setPlayingNoteId(null);
        });
      } catch (e) {
        setPlayingNoteId(null);
        Alert.alert('Áudio', 'Não foi possível reproduzir este áudio gravado.');
      }
    }
  };

  const handleDeleteStudentPrompt = () => {
    if (typeof window !== 'undefined' && window.confirm) {
      if (window.confirm(`Tem certeza que deseja excluir a pasta de ${student.name} e todas as suas ${notes.length} anotações?`)) {
        handleModalClose();
        onDeleteStudent(student.id);
      }
    } else {
      handleModalClose();
      onDeleteStudent(student.id);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleModalClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Cabeçalho da Pasta do Aluno */}
          <View style={styles.modalHeader}>
            <View style={styles.studentTitleBlock}>
              <View style={[styles.avatarCircle, { backgroundColor: student.avatarColor || '#059669' }]}>
                <Text style={styles.avatarText}>{student.name.charAt(0)}</Text>
              </View>
              <View>
                <Text style={styles.studentName}>{student.name}</Text>
                <Text style={styles.studentGrade}>{student.grade || 'Turma Principal'}</Text>
              </View>
            </View>

            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Barra de Ações Rápidas do Aluno */}
          <View style={styles.quickActionsBar}>
            <TouchableOpacity
              style={styles.voiceActionBtn}
              onPress={() => {
                onClose();
                onStartVoiceForStudent(student);
              }}
            >
              <Ionicons name="mic" size={16} color="#fff" />
              <Text style={styles.voiceActionText}>Gravar por Voz</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionOutlineBtn}
              onPress={() => setIsAddingNote(!isAddingNote)}
            >
              <Ionicons
                name={isAddingNote ? 'close-outline' : 'add-circle-outline'}
                size={16}
                color="#15803d"
              />
              <Text style={styles.actionOutlineText}>
                {isAddingNote ? 'Cancelar' : 'Nova Nota'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.exportBtn} onPress={handleExportNotes}>
              <Ionicons
                name={copiedNotification ? 'checkmark' : 'copy-outline'}
                size={16}
                color="#2563eb"
              />
              <Text style={styles.exportText}>
                {copiedNotification ? 'Copiado!' : 'Exportar'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Form Manual de Nova Nota */}
          {isAddingNote && (
            <View style={styles.newNoteCard}>
              <Text style={styles.newNoteTitle}>Adicionar anotação manual</Text>
              <TextInput
                style={styles.noteInput}
                multiline
                numberOfLines={3}
                placeholder="Digite a observação pedagógica ou comportamental..."
                placeholderTextColor="#94a3b8"
                value={newNoteText}
                onChangeText={setNewNoteText}
                autoFocus
              />

              {/* Categorias */}
              <View style={styles.categoriesRow}>
                {CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat.value}
                    style={[
                      styles.categoryChip,
                      selectedCategory === cat.value && {
                        backgroundColor: cat.color,
                        borderColor: cat.color,
                      },
                    ]}
                    onPress={() => setSelectedCategory(cat.value)}
                  >
                    <Text
                      style={[
                        styles.categoryChipText,
                        selectedCategory === cat.value && { color: '#fff' },
                      ]}
                    >
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={styles.saveNoteBtn} onPress={handleSaveNote}>
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={styles.saveNoteBtnText}>Salvar Anotação</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Lista de Anotações */}
          <Text style={styles.sectionTitle}>
            Histórico de Anotações ({notes.length})
          </Text>

          <ScrollView style={styles.notesList} contentContainerStyle={styles.notesListContent}>
            {notes.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="document-text-outline" size={44} color="#cbd5e1" />
                <Text style={styles.emptyTitle}>Nenhuma anotação nesta pasta</Text>
                <Text style={styles.emptySubtitle}>
                  Fale "Professora, anotar para {student.name.split(' ')[0]}..." ou clique em "Gravar por Voz".
                </Text>
              </View>
            ) : (
              notes.map((note) => {
                const catInfo = CATEGORIES.find((c) => c.value === note.category) || CATEGORIES[0];
                const dateStr = new Date(note.createdAt).toLocaleDateString('pt-BR');
                const timeStr = new Date(note.createdAt).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <View key={note.id} style={styles.noteItem}>
                    <View style={styles.noteItemHeader}>
                      <View style={[styles.catBadge, { backgroundColor: catInfo.color + '18' }]}>
                        <Text style={[styles.catBadgeText, { color: catInfo.color }]}>
                          {catInfo.label}
                        </Text>
                      </View>

                      <View style={styles.noteMetaRow}>
                        {note.recordedViaVoice && (
                          <View style={styles.voiceBadge}>
                            <Ionicons name="mic" size={11} color="#15803d" />
                            <Text style={styles.voiceBadgeText}>Voz</Text>
                          </View>
                        )}
                        <Text style={styles.noteDateText}>{dateStr} {timeStr}</Text>
                        <TouchableOpacity
                          style={styles.deleteNoteBtn}
                          onPress={() => onDeleteNote(note.id)}
                        >
                          <Ionicons name="trash-outline" size={14} color="#94a3b8" />
                        </TouchableOpacity>
                      </View>
                    </View>

                    <Text style={styles.noteTextContent}>{note.text}</Text>

                    {note.audioUri && (
                      <TouchableOpacity
                        style={styles.audioPlayBtn}
                        onPress={() => handleTogglePlayAudio(note.id, note.audioUri!)}
                      >
                        <Ionicons
                          name={playingNoteId === note.id ? 'pause-circle' : 'play-circle'}
                          size={22}
                          color="#2563eb"
                        />
                        <Text style={styles.audioPlayBtnText}>
                          {playingNoteId === note.id ? 'Pausar áudio' : 'Ouvir gravação'}
                          {note.audioDurationSeconds ? ` (${note.audioDurationSeconds}s)` : ''}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* Rodapé - Opção de Excluir Pasta */}
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={styles.deleteFolderBtn}
              onPress={handleDeleteStudentPrompt}
            >
              <Ionicons name="trash-bin-outline" size={15} color="#ef4444" />
              <Text style={styles.deleteFolderText}>Excluir pasta do aluno</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    minHeight: '65%',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  studentTitleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  studentName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  studentGrade: {
    fontSize: 13,
    color: '#64748b',
  },
  closeBtn: {
    padding: 6,
  },
  quickActionsBar: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  voiceActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#15803d',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 6,
  },
  voiceActionText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  actionOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#15803d',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 6,
  },
  actionOutlineText: {
    fontSize: 13,
    color: '#15803d',
    fontWeight: '600',
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#93c5fd',
    backgroundColor: '#eff6ff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 6,
    marginLeft: 'auto',
  },
  exportText: {
    fontSize: 13,
    color: '#2563eb',
    fontWeight: '600',
  },
  newNoteCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 14,
  },
  newNoteTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  noteInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: '#0f172a',
    textAlignVertical: 'top',
    marginBottom: 8,
  },
  categoriesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  categoryChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  categoryChipText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
  },
  saveNoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#15803d',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  saveNoteBtnText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 10,
  },
  notesList: {
    flex: 1,
  },
  notesListContent: {
    paddingBottom: 20,
    gap: 10,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 280,
  },
  noteItem: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
  },
  noteItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  catBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  catBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  noteMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  voiceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 2,
  },
  voiceBadgeText: {
    fontSize: 10,
    color: '#15803d',
    fontWeight: '700',
  },
  noteDateText: {
    fontSize: 11,
    color: '#94a3b8',
  },
  deleteNoteBtn: {
    padding: 2,
  },
  noteTextContent: {
    fontSize: 14,
    color: '#1e293b',
    lineHeight: 20,
  },
  modalFooter: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 12,
    alignItems: 'center',
  },
  deleteFolderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 6,
  },
  deleteFolderText: {
    fontSize: 13,
    color: '#ef4444',
    fontWeight: '500',
  },
  audioPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    backgroundColor: '#eff6ff',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    alignSelf: 'flex-start',
  },
  audioPlayBtnText: {
    fontSize: 13,
    color: '#2563eb',
    fontWeight: '600',
  },
});
