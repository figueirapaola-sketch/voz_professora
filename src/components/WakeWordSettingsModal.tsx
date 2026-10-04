import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { databaseService } from '../services/databaseService';
import { offlineWakeWordService, WakeWordMetrics, WakeWordState } from '../services/offlineWakeWordService';
import { soundEffectsService } from '../services/soundEffectsService';
import { SystemSettings } from '../types';

interface WakeWordSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onSettingsUpdated: (settings: SystemSettings) => void;
}

export const WakeWordSettingsModal: React.FC<WakeWordSettingsModalProps> = ({
  visible,
  onClose,
  onSettingsUpdated,
}) => {
  const [settings, setSettings] = useState<SystemSettings>(databaseService.getSettings());
  const [isTesting, setIsTesting] = useState(false);
  const [testMetrics, setTestMetrics] = useState<WakeWordMetrics>({
    volumeDb: -80,
    isSpeechDetected: false,
    confidenceScore: 0,
  });
  const [testDetection, setTestDetection] = useState<{ word: string; score: number } | null>(null);

  useEffect(() => {
    if (visible) {
      setSettings(databaseService.getSettings());
      setIsTesting(false);
      setTestDetection(null);
    } else {
      if (isTesting) {
        offlineWakeWordService.stopListening();
        setIsTesting(false);
      }
    }
  }, [visible]);

  // Salva alteração de sensibilidade
  const handleSelectSensitivity = (sens: 'baixa' | 'media' | 'alta') => {
    const updated = databaseService.saveSettings({ wakeWordSensitivity: sens });
    setSettings(updated);
    onSettingsUpdated(updated);
  };

  // Alterna ativação global do wake word
  const handleToggleWakeWord = (enabled: boolean) => {
    const updated = databaseService.saveSettings({
      continuousListening: enabled,
      offlineWakeWordEnabled: enabled,
    });
    setSettings(updated);
    onSettingsUpdated(updated);
  };

  // Inicia ou para teste em tempo real no modal
  const handleToggleTest = async () => {
    if (isTesting) {
      offlineWakeWordService.stopListening();
      setIsTesting(false);
      setTestDetection(null);
    } else {
      setIsTesting(true);
      setTestDetection(null);
      soundEffectsService.playWakeWordChime();

      await offlineWakeWordService.startListening({
        onMetrics: (m) => {
          setTestMetrics(m);
        },
        onDetected: (word, score) => {
          setTestDetection({ word, score });
          soundEffectsService.playWakeWordChime();
          soundEffectsService.playSaveSuccessChime();
        },
      });
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerTitleContainer}>
              <View style={styles.iconCircle}>
                <Ionicons name="hardware-chip-outline" size={22} color="#15803d" />
              </View>
              <View>
                <Text style={styles.title}>Wake Word Offline</Text>
                <Text style={styles.subtitle}>Detecção acústica local no dispositivo</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Badge 100% Offline */}
          <View style={styles.badgeOffline}>
            <Ionicons name="shield-checkmark" size={16} color="#16a34a" />
            <Text style={styles.badgeOfflineText}>
              100% Offline • Sem internet • Privacidade total
            </Text>
          </View>

          {/* Card Ativar Escuta */}
          <View style={styles.toggleCard}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={styles.toggleCardTitle}>Escuta Contínua Ativa</Text>
              <Text style={styles.toggleCardDesc}>
                O aplicativo escuta continuamente em segundo plano pela palavra{' '}
                <Text style={{ fontWeight: '700', color: '#15803d' }}>"Professora"</Text>.
              </Text>
            </View>
            <Switch
              value={!!settings.continuousListening}
              onValueChange={handleToggleWakeWord}
              trackColor={{ false: '#cbd5e1', true: '#86efac' }}
              thumbColor={settings.continuousListening ? '#15803d' : '#f8fafc'}
            />
          </View>

          {/* Seletor de Sensibilidade */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Sensibilidade de Detecção</Text>
            <Text style={styles.sectionSubtitle}>
              Ajuste para equilibrar o ambiente da sua sala de aula
            </Text>

            <View style={styles.sensitivityRow}>
              {(['baixa', 'media', 'alta'] as const).map((sens) => {
                const isSelected = (settings.wakeWordSensitivity || 'media') === sens;
                const labels = {
                  baixa: 'Baixa\n(Anti-ruído)',
                  media: 'Média\n(Recomendada)',
                  alta: 'Alta\n(Mais sensível)',
                };
                return (
                  <TouchableOpacity
                    key={sens}
                    style={[
                      styles.sensBtn,
                      isSelected && styles.sensBtnActive,
                    ]}
                    onPress={() => handleSelectSensitivity(sens)}
                  >
                    <Ionicons
                      name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                      size={16}
                      color={isSelected ? '#15803d' : '#64748b'}
                    />
                    <Text
                      style={[
                        styles.sensBtnText,
                        isSelected && styles.sensBtnTextActive,
                      ]}
                    >
                      {labels[sens]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Teste Interativo em Tempo Real */}
          <View style={styles.testSection}>
            <View style={styles.testHeaderRow}>
              <Text style={styles.testTitle}>Teste de Voz em Tempo Real</Text>
              <TouchableOpacity
                style={[styles.testBtn, isTesting && styles.testBtnActive]}
                onPress={handleToggleTest}
              >
                <Ionicons
                  name={isTesting ? 'stop-circle' : 'play-circle'}
                  size={16}
                  color="#fff"
                />
                <Text style={styles.testBtnText}>
                  {isTesting ? 'Parar Teste' : 'Testar Agora'}
                </Text>
              </TouchableOpacity>
            </View>

            {isTesting ? (
              <View style={styles.testActiveBox}>
                <View style={styles.liveVolumeRow}>
                  <Ionicons name="mic" size={18} color="#15803d" />
                  <Text style={styles.liveText}>
                    Diga claramente:{' '}
                    <Text style={{ fontWeight: '700', color: '#15803d' }}>
                      "Professora"
                    </Text>
                  </Text>
                  <Text style={styles.dbText}>{testMetrics.volumeDb} dB</Text>
                </View>

                {/* Barra de volume em tempo real */}
                <View style={styles.volumeBarBg}>
                  <View
                    style={[
                      styles.volumeBarFill,
                      {
                        width: `${Math.min(
                          100,
                          Math.max(5, ((testMetrics.volumeDb + 70) / 70) * 100)
                        )}%`,
                      },
                    ]}
                  />
                </View>

                {testDetection ? (
                  <View style={styles.detectedSuccessBox}>
                    <Ionicons name="checkmark-circle" size={24} color="#16a34a" />
                    <View style={{ marginLeft: 8 }}>
                      <Text style={styles.detectedTitle}>
                        Palavra "Professora" Reconhecida!
                      </Text>
                      <Text style={styles.detectedDesc}>
                        Confiança: {testDetection.score}% • Reconhecido 100% offline
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.waitingDetectionBox}>
                    <ActivityIndicator size="small" color="#15803d" />
                    <Text style={styles.waitingText}>
                      Aguardando você falar a palavra-chave...
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <Text style={styles.testTip}>
                Toque em "Testar Agora" e fale "Professora" para verificar a detecção no seu microfone.
              </Text>
            )}
          </View>

          {/* Botão Fechar */}
          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>Concluído</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    width: '100%',
    maxWidth: 500,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#dcfce7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  badgeOffline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  badgeOfflineText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#166534',
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 16,
  },
  toggleCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  toggleCardDesc: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
    lineHeight: 17,
  },
  sectionContainer: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    marginBottom: 10,
  },
  sensitivityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sensBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
    gap: 4,
  },
  sensBtnActive: {
    borderColor: '#15803d',
    backgroundColor: '#f0fdf4',
  },
  sensBtnText: {
    fontSize: 11,
    textAlign: 'center',
    color: '#64748b',
    fontWeight: '500',
    lineHeight: 14,
  },
  sensBtnTextActive: {
    color: '#15803d',
    fontWeight: '700',
  },
  testSection: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 18,
  },
  testHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  testTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#15803d',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  testBtnActive: {
    backgroundColor: '#dc2626',
  },
  testBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  testTip: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 8,
    lineHeight: 16,
  },
  testActiveBox: {
    marginTop: 12,
  },
  liveVolumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  liveText: {
    fontSize: 12,
    color: '#334155',
    flex: 1,
    marginLeft: 6,
  },
  dbText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  volumeBarBg: {
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 10,
  },
  volumeBarFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 4,
  },
  detectedSuccessBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 10,
    padding: 10,
  },
  detectedTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#15803d',
  },
  detectedDesc: {
    fontSize: 11,
    color: '#166534',
    marginTop: 2,
  },
  waitingDetectionBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  waitingText: {
    fontSize: 12,
    color: '#64748b',
    fontStyle: 'italic',
  },
  doneBtn: {
    backgroundColor: '#15803d',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
