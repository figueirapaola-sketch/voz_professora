import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface NewStudentModalProps {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string, grade: string) => void;
}

export const NewStudentModal: React.FC<NewStudentModalProps> = ({
  visible,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [error, setError] = useState('');

  const handleSave = () => {
    if (!name.trim()) {
      setError('Por favor, informe o nome do aluno.');
      return;
    }
    setError('');
    onCreate(name.trim(), grade.trim() || 'Turma Principal');
    setName('');
    setGrade('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Cabeçalho */}
          <View style={styles.modalHeader}>
            <View style={styles.titleWithIcon}>
              <Ionicons name="folder-outline" size={22} color="#15803d" />
              <Text style={styles.modalTitle}>Nova Pasta de Aluno</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeIconButton}>
              <Ionicons name="close" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          <Text style={styles.modalSubtitle}>
            Crie manualmente ou diga por voz:{' '}
            <Text style={styles.voiceExampleText}>"Criar pasta do aluno Pedro"</Text>
          </Text>

          {/* Campo Nome */}
          <Text style={styles.inputLabel}>Nome do Aluno *</Text>
          <TextInput
            style={[styles.input, !!error && styles.inputError]}
            placeholder="Ex: Beatriz Monteiro"
            placeholderTextColor="#94a3b8"
            value={name}
            onChangeText={(text) => {
              setName(text);
              if (error) setError('');
            }}
            autoFocus
          />
          {!!error && <Text style={styles.errorText}>{error}</Text>}

          {/* Campo Turma */}
          <Text style={styles.inputLabel}>Turma / Série</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: 3º Ano B - Manhã"
            placeholderTextColor="#94a3b8"
            value={grade}
            onChangeText={setGrade}
          />

          {/* Ações */}
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.submitBtn} onPress={handleSave}>
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={styles.submitBtnText}>Criar Pasta</Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  titleWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  closeIconButton: {
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 16,
    lineHeight: 18,
  },
  voiceExampleText: {
    color: '#15803d',
    fontWeight: '600',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
    marginBottom: 14,
  },
  inputError: {
    borderColor: '#ef4444',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    marginTop: -10,
    marginBottom: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  cancelBtnText: {
    fontSize: 14,
    color: '#475569',
    fontWeight: '600',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#15803d',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    gap: 6,
  },
  submitBtnText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
});
