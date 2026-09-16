import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface CountdownTimerProps {
  remainingSeconds: number;
  totalSeconds?: number;
  onSaveNow: () => void;
  onCancel: () => void;
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({
  remainingSeconds,
  totalSeconds = 10,
  onSaveNow,
  onCancel,
}) => {
  const progressPercent = Math.max(0, Math.min(100, (remainingSeconds / totalSeconds) * 100));
  const isUrgent = remainingSeconds <= 3;

  return (
    <View style={styles.container}>
      {/* Header com indicador de silêncio */}
      <View style={styles.headerRow}>
        <View style={styles.titleWithIcon}>
          <Ionicons
            name="timer-outline"
            size={18}
            color={isUrgent ? '#dc2626' : '#16a34a'}
          />
          <Text style={[styles.title, isUrgent && styles.titleUrgent]}>
            Silêncio detectado ({remainingSeconds}s)
          </Text>
        </View>

        <Text style={styles.subtitle}>
          Finalizando e salvando em {remainingSeconds} segundo{remainingSeconds !== 1 ? 's' : ''}...
        </Text>
      </View>

      {/* Barra de Progresso Regressiva */}
      <View style={styles.progressBarBackground}>
        <View
          style={[
            styles.progressBarFill,
            {
              width: `${progressPercent}%`,
              backgroundColor: isUrgent ? '#ef4444' : '#22c55e',
            },
          ]}
        />
      </View>

      {/* Botões de Ação Rápida */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
          <Ionicons name="close-circle-outline" size={16} color="#64748b" />
          <Text style={styles.cancelText}>Descartar</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.saveNowButton} onPress={onSaveNow}>
          <Ionicons name="checkmark-sharp" size={16} color="#fff" />
          <Text style={styles.saveNowText}>Salvar Agora</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginVertical: 10,
    width: '100%',
  },
  headerRow: {
    marginBottom: 8,
  },
  titleWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#16a34a',
  },
  titleUrgent: {
    color: '#dc2626',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748b',
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
    marginVertical: 8,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  cancelText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  saveNowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#15803d',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 6,
  },
  saveNowText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
});
