import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Student } from '../types';

interface StudentFolderCardProps {
  student: Student;
  isSelected: boolean;
  onSelect: (student: Student) => void;
  onOpenDetails: (student: Student) => void;
}

export const StudentFolderCard: React.FC<StudentFolderCardProps> = ({
  student,
  isSelected,
  onSelect,
  onOpenDetails,
}) => {
  // Obter as iniciais do aluno (ex: "Ana Clara" -> "AC")
  const initials = student.name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');

  return (
    <View style={[styles.card, isSelected && styles.cardSelected]}>
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={() => onSelect(student)}
        activeOpacity={0.7}
      >
        {/* Pasta & Avatar */}
        <View style={styles.iconContainer}>
          <View style={[styles.avatarCircle, { backgroundColor: student.avatarColor || '#059669' }]}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
          <View style={styles.folderBadge}>
            <Ionicons name="folder" size={14} color="#eab308" />
          </View>
        </View>

        {/* Informações do Aluno */}
        <View style={styles.studentInfo}>
          <Text style={styles.studentName} numberOfLines={1}>
            {student.name}
          </Text>
          <Text style={styles.studentGrade} numberOfLines={1}>
            {student.grade || 'Sem turma'}
          </Text>
        </View>

        {/* Badge de Selecionado */}
        {isSelected && (
          <View style={styles.activeTag}>
            <Ionicons name="checkmark-circle" size={14} color="#15803d" />
            <Text style={styles.activeTagText}>Ativo</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Rodapé da Pasta com Contagem e Botão Abrir */}
      <View style={styles.cardFooter}>
        <View style={styles.notesCountBadge}>
          <Ionicons name="document-text-outline" size={14} color="#64748b" />
          <Text style={styles.notesCountText}>
            {student.notesCount || 0} {student.notesCount === 1 ? 'nota' : 'notas'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.openFolderButton}
          onPress={() => onOpenDetails(student)}
        >
          <Text style={styles.openFolderText}>Abrir Pasta</Text>
          <Ionicons name="chevron-forward" size={14} color="#15803d" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardSelected: {
    borderColor: '#16a34a',
    backgroundColor: '#f0fdf4',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconContainer: {
    position: 'relative',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  folderBadge: {
    position: 'absolute',
    bottom: -2,
    right: -4,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 2,
  },
  studentGrade: {
    fontSize: 12,
    color: '#64748b',
  },
  activeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
  },
  activeTagText: {
    fontSize: 11,
    color: '#15803d',
    fontWeight: '700',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  notesCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  notesCountText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  openFolderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  openFolderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#15803d',
  },
});
