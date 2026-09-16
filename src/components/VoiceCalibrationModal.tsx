import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { audioProfileService } from '../services/audioProfileService';
import { databaseService } from '../services/databaseService';
import { soundEffectsService } from '../services/soundEffectsService';
import { VoiceProfile } from '../types';

interface VoiceCalibrationModalProps {
  visible: boolean;
  onClose: () => void;
  onProfileUpdated: (profile: VoiceProfile) => void;
}

export const VoiceCalibrationModal: React.FC<VoiceCalibrationModalProps> = ({
  visible,
  onClose,
  onProfileUpdated,
}) => {
  const [profile, setProfile] = useState<VoiceProfile>(databaseService.getVoiceProfile());
  const [teacherName, setTeacherName] = useState(profile.teacherName || 'Professora');
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [livePitch, setLivePitch] = useState(0);
  const [liveDb, setLiveDb] = useState(-60);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      const current = databaseService.getVoiceProfile();
      setProfile(current);
      setTeacherName(current.teacherName || 'Professora');
      setIsCalibrating(false);
      setProgress(0);
      setErrorMessage(null);
      setSuccessMessage(null);
    } else {
      audioProfileService.cancelCalibration();
    }
  }, [visible]);

  const handleStartCalibration = async () => {
    setIsCalibrating(true);
    setProgress(0);
    setErrorMessage(null);
    setSuccessMessage(null);
    soundEffectsService.playWakeWordChime();

    try {
      const newProfile = await audioProfileService.calibrateVoice(
        teacherName,
        4500,
        (prog, current) => {
          setProgress(prog);
          setLivePitch(current.pitch);
          setLiveDb(current.db);
        }
      );

      setProfile(newProfile);
      setIsCalibrating(false);
      setSuccessMessage('Voz calibrada e perfil salvo com sucesso!');
      soundEffectsService.playSaveSuccessChime();
      onProfileUpdated(newProfile);
    } catch (err: any) {
      console.warn('Erro na calibração de voz:', err);
      setIsCalibrating(false);
      setProgress(0);
      if (err?.message !== 'Calibração cancelada pelo usuário.') {
        setErrorMessage(
          err?.message ||
            'Não foi possível calibrar a voz. Verifique as permissões do microfone no seu navegador.'
        );
      }
    }
  };

  const handleCancelCalibration = () => {
    audioProfileService.cancelCalibration();
    setIsCalibrating(false);
    setProgress(0);
  };

  const handleApplyPreset = (gender: 'feminino' | 'masculino') => {
    setErrorMessage(null);
    const newProfile = audioProfileService.createStandardProfile(teacherName, gender);
    setProfile(newProfile);
    soundEffectsService.playSaveSuccessChime();
    setSuccessMessage(
      `Perfil ${gender === 'feminino' ? 'Feminino (215 Hz)' : 'Masculino (130 Hz)'} aplicado com sucesso!`
    );
    onProfileUpdated(newProfile);
  };

  const handleToggleNoiseFilter = (value: boolean) => {
    const updated = { ...profile, noiseFilterEnabled: value };
    setProfile(updated);
    databaseService.saveVoiceProfile(updated);
    onProfileUpdated(updated);
  };

  const handleFinish = () => {
    audioProfileService.cancelCalibration();
    const cleanName = teacherName.trim() || 'Professora';
    if (cleanName !== profile.teacherName) {
      const updated = { ...profile, teacherName: cleanName };
      databaseService.saveVoiceProfile(updated);
      setProfile(updated);
      onProfileUpdated(updated);
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleFinish}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Cabeçalho */}
          <View style={styles.modalHeader}>
            <View style={styles.titleWithIcon}>
              <Ionicons name="finger-print-outline" size={22} color="#15803d" />
              <Text style={styles.modalTitle}>Biometria Vocal & Filtro de Ruído</Text>
            </View>
            <TouchableOpacity onPress={handleFinish} style={styles.closeBtn} disabled={isCalibrating}>
              <Ionicons name="close" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          <Text style={styles.modalSubtitle}>
            O sistema armazena a frequência e características da sua voz no banco de dados para
            diferenciar sua fala dos ruídos e conversas da sala de aula.
          </Text>

          {/* Banner de Erro */}
          {errorMessage && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={20} color="#b91c1c" />
              <View style={styles.errorContent}>
                <Text style={styles.errorTitle}>Atenção</Text>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
              <TouchableOpacity onPress={() => setErrorMessage(null)} style={styles.errorDismiss}>
                <Ionicons name="close" size={16} color="#b91c1c" />
              </TouchableOpacity>
            </View>
          )}

          {/* Banner de Sucesso */}
          {successMessage && (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle" size={20} color="#15803d" />
              <Text style={styles.successText}>{successMessage}</Text>
            </View>
          )}

          {/* Nome da Professora */}
          <Text style={styles.inputLabel}>Nome da Professora</Text>
          <TextInput
            style={styles.input}
            value={teacherName}
            onChangeText={setTeacherName}
            placeholder="Ex: Profa. Juliana"
            placeholderTextColor="#94a3b8"
            editable={!isCalibrating}
          />

          {/* Card de Status da Calibração */}
          <View style={styles.statusCard}>
            <View style={styles.statusHeaderRow}>
              <View style={styles.statusTitleBlock}>
                <Ionicons
                  name={profile.calibrated ? 'checkmark-circle' : 'alert-circle-outline'}
                  size={20}
                  color={profile.calibrated ? '#16a34a' : '#eab308'}
                />
                <Text style={styles.statusTitle}>
                  {profile.calibrated ? 'Voz Calibrada no Banco' : 'Calibração Pendente'}
                </Text>
              </View>

              {profile.calibratedAt && (
                <Text style={styles.statusDate}>
                  {new Date(profile.calibratedAt).toLocaleDateString('pt-BR')}
                </Text>
              )}
            </View>

            {/* Métricas do Perfil */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Frequência Média</Text>
                <Text style={styles.metricValue}>{profile.averagePitchHz} Hz</Text>
                <Text style={styles.metricSub}>Pitch vocal</Text>
              </View>

              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Ruído de Base</Text>
                <Text style={styles.metricValue}>{profile.noiseFloorDb} dB</Text>
                <Text style={styles.metricSub}>Piso da sala</Text>
              </View>

              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Timbre Espectral</Text>
                <Text style={styles.metricValue}>{Math.round(profile.spectralCentroid)} Hz</Text>
                <Text style={styles.metricSub}>Centróide</Text>
              </View>
            </View>

            {/* Toggle de Filtro Inteligente */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextContainer}>
                <Text style={styles.toggleTitle}>Filtro de Ruído Inteligente</Text>
                <Text style={styles.toggleSubtitle}>
                  Ignora barulhos e vozes de crianças fora da sua frequência
                </Text>
              </View>
              <Switch
                value={profile.noiseFilterEnabled}
                onValueChange={handleToggleNoiseFilter}
                trackColor={{ false: '#cbd5e1', true: '#86efac' }}
                thumbColor={profile.noiseFilterEnabled ? '#15803d' : '#f8fafc'}
              />
            </View>
          </View>

          {/* Área de Calibração Ativa */}
          {isCalibrating ? (
            <View style={styles.calibratingBox}>
              <Text style={styles.calibratingTitle}>Gravando e analisando sua voz...</Text>
              <Text style={styles.phraseToSpeak}>
                "Eu sou a professora e estou registrando as observações da turma."
              </Text>

              {/* Barra de Progresso */}
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress}%` }]} />
              </View>

              <View style={styles.liveMetricsRow}>
                <Text style={styles.liveMetricText}>Volume: {liveDb} dB</Text>
                <Text style={styles.liveMetricText}>Pitch: {livePitch} Hz</Text>
                <Text style={styles.liveMetricText}>{progress}%</Text>
              </View>

              <TouchableOpacity style={styles.cancelCalibrateBtn} onPress={handleCancelCalibration}>
                <Ionicons name="stop-circle-outline" size={17} color="#dc2626" />
                <Text style={styles.cancelCalibrateBtnText}>Cancelar Calibração</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actionBlock}>
              <TouchableOpacity style={styles.calibrateButton} onPress={handleStartCalibration}>
                <Ionicons name="mic-circle-outline" size={22} color="#fff" />
                <Text style={styles.calibrateButtonText}>
                  {profile.calibrated ? 'Recalibrar Perfil no Microfone' : 'Iniciar Calibração no Microfone'}
                </Text>
              </TouchableOpacity>

              {/* Opções de Perfil Pré-definido */}
              <View style={styles.presetContainer}>
                <Text style={styles.presetHeading}>Ou definir por padrão de voz:</Text>
                <View style={styles.presetButtonsRow}>
                  <TouchableOpacity
                    style={styles.presetBtn}
                    onPress={() => handleApplyPreset('feminino')}
                  >
                    <Ionicons name="woman" size={14} color="#15803d" />
                    <Text style={styles.presetBtnText}>Padrão Feminino (215 Hz)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.presetBtn}
                    onPress={() => handleApplyPreset('masculino')}
                  >
                    <Ionicons name="man" size={14} color="#15803d" />
                    <Text style={styles.presetBtnText}>Padrão Masculino (130 Hz)</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          <TouchableOpacity style={styles.finishBtn} onPress={handleFinish} disabled={isCalibrating}>
            <Text style={styles.finishBtnText}>Concluir</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 460,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  titleWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  closeBtn: {
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 14,
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
    paddingVertical: 9,
    fontSize: 14,
    color: '#0f172a',
    marginBottom: 14,
  },
  statusCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 16,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusTitleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  statusDate: {
    fontSize: 11,
    color: '#94a3b8',
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  metricItem: {
    alignItems: 'center',
    flex: 1,
  },
  metricLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  metricValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#15803d',
    marginVertical: 2,
  },
  metricSub: {
    fontSize: 10,
    color: '#94a3b8',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  toggleTextContainer: {
    flex: 1,
    paddingRight: 10,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
  },
  toggleSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  calibratingBox: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    padding: 14,
    alignItems: 'center',
    marginBottom: 14,
  },
  calibratingTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#15803d',
    marginBottom: 6,
  },
  phraseToSpeak: {
    fontSize: 13,
    fontStyle: 'italic',
    color: '#166534',
    textAlign: 'center',
    marginBottom: 10,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    backgroundColor: '#dcfce7',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#16a34a',
    borderRadius: 4,
  },
  liveMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 8,
  },
  liveMetricText: {
    fontSize: 11,
    color: '#15803d',
    fontWeight: '600',
  },
  calibrateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#15803d',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
    marginBottom: 10,
  },
  calibrateButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  cancelCalibrateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    gap: 6,
    marginTop: 10,
  },
  cancelCalibrateBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#b91c1c',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 10,
    gap: 8,
    marginBottom: 12,
  },
  errorContent: {
    flex: 1,
  },
  errorTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991b1b',
    marginBottom: 2,
  },
  errorText: {
    fontSize: 12,
    color: '#b91c1c',
    lineHeight: 16,
  },
  errorDismiss: {
    padding: 2,
  },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 10,
    padding: 10,
    gap: 8,
    marginBottom: 12,
  },
  successText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#15803d',
    flex: 1,
  },
  actionBlock: {
    marginBottom: 6,
  },
  presetContainer: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
    marginBottom: 8,
  },
  presetHeading: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    marginBottom: 6,
  },
  presetButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  presetBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 8,
    gap: 5,
  },
  presetBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  finishBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  finishBtnText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '600',
  },
});
