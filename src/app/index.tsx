import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { AudioVisualizer } from '../components/AudioVisualizer';
import { CountdownTimer } from '../components/CountdownTimer';
import { NewStudentModal } from '../components/NewStudentModal';
import { StudentDetailsModal } from '../components/StudentDetailsModal';
import { StudentFolderCard } from '../components/StudentFolderCard';
import { TranscriptionSettingsModal } from '../components/TranscriptionSettingsModal';
import { VoiceCalibrationModal } from '../components/VoiceCalibrationModal';
import { WakeWordSettingsModal } from '../components/WakeWordSettingsModal';

import { databaseService } from '../services/databaseService';
import { nativeAudioService } from '../services/nativeAudioService';
import { offlineWakeWordService } from '../services/offlineWakeWordService';
import { soundEffectsService } from '../services/soundEffectsService';
import { speechRecognitionService } from '../services/speechRecognitionService';
import { transcriptionService } from '../services/transcriptionService';
import { Note, NoteCategory, Student, SystemSettings, VoiceProfile, VoiceState } from '../types';

export default function App() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 860;

  // Estados dos Dados
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile>(databaseService.getVoiceProfile());
  const [settings, setSettings] = useState<SystemSettings>(databaseService.getSettings());

  // Estados de Voz
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [isInterim, setIsInterim] = useState(false);
  const [remainingSilenceSeconds, setRemainingSilenceSeconds] = useState(10);
  const [voiceNotification, setVoiceNotification] = useState<string | null>(null);

  // Estados de Navegação & UI
  const [activeTab, setActiveTab] = useState<'ditado' | 'pastas' | 'historico' | 'perfil'>('ditado');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<NoteCategory>('geral');

  // Modais
  const [isNewStudentModalOpen, setIsNewStudentModalOpen] = useState(false);
  const [isCalibrationModalOpen, setIsCalibrationModalOpen] = useState(false);
  const [isTranscriptionModalOpen, setIsTranscriptionModalOpen] = useState(false);
  const [isWakeWordModalOpen, setIsWakeWordModalOpen] = useState(false);
  const [detailsStudent, setDetailsStudent] = useState<Student | null>(null);

  // Carregar dados iniciais
  useEffect(() => {
    loadData();
    databaseService.getSecureTranscriptionKey().then(() => {
      setSettings(databaseService.getSettings());
    });
    const saved = databaseService.getSettings();
    if (saved.continuousListening) {
      setTimeout(() => {
        startOfflineWakeWord();
      }, 1000);
    }
    return () => {
      offlineWakeWordService.stopListening();
    };
  }, []);

  const loadData = () => {
    const loadedStudents = databaseService.getStudents();
    setStudents(loadedStudents);

    const savedSettings = databaseService.getSettings();
    setSettings(savedSettings);

    const profile = databaseService.getVoiceProfile();
    setVoiceProfile(profile);

    // Seleciona o primeiro aluno se houver
    if (loadedStudents.length > 0 && !selectedStudent) {
      const active = loadedStudents.find((s) => s.id === savedSettings.selectedStudentId) || loadedStudents[0];
      setSelectedStudent(active);
    }
  };

  // Configurar Callbacks do Serviço de Reconhecimento de Voz
  useEffect(() => {
    speechRecognitionService.setCallbacks({
      onStateChange: (state) => {
        setVoiceState(state);
      },
      onTranscriptChange: (text, interim) => {
        setTranscript(text);
        setIsInterim(interim);
      },
      onCountdownTick: (seconds) => {
        setRemainingSilenceSeconds(seconds);
      },
      onVoiceCommand: (cmd) => {
        handleVoiceCommand(cmd);
      },
      onAutoFinalize: (finalText) => {
        handleSaveNote(finalText, true);
        if (databaseService.getSettings().continuousListening) {
          setTimeout(() => {
            startOfflineWakeWord();
          }, 1200);
        }
      },
      onError: (errMsg) => {
        showToast(errMsg);
      },
    });

    return () => {
      speechRecognitionService.stop();
    };
  }, [selectedStudent, students]);

  // Exibir notificação toast temporária
  const showToast = (message: string) => {
    setVoiceNotification(message);
    setTimeout(() => {
      setVoiceNotification(null);
    }, 4500);
  };

  // Processamento de Comandos de Voz
  const handleVoiceCommand = (cmd: any) => {
    if (cmd.type === 'create_folder' && cmd.studentName) {
      // Cria a pasta do aluno por voz
      const newSt = databaseService.createStudentFolder(cmd.studentName);
      setStudents(databaseService.getStudents());
      setSelectedStudent(newSt);
      const msg = `Pasta criada para o aluno: ${newSt.name}!`;
      showToast(`📁 ${msg}`);
      soundEffectsService.speak(msg);
    } else if (cmd.type === 'dictate_to_student' && cmd.studentName) {
      // Localiza o aluno mencionado
      const found = databaseService.findStudentByName(cmd.studentName);
      if (found) {
        setSelectedStudent(found);
        showToast(`Gravando anotação para ${found.name}`);
      }
    }
  };

  // Salvar anotação
  const handleSaveNote = (
    textToSave?: string,
    isVoice = false,
    audioUri?: string,
    audioDurationSeconds?: number
  ) => {
    const content = (textToSave || transcript).trim();
    if (!content && !audioUri) return;

    const targetStudent = selectedStudent || students[0];
    const targetStudentId = targetStudent ? targetStudent.id : 'geral';
    const targetStudentName = targetStudent ? targetStudent.name : 'Anotações Gerais';

    databaseService.addNote(
      targetStudentId,
      targetStudentName,
      content || 'Gravação de voz',
      selectedCategory,
      isVoice,
      audioUri,
      audioDurationSeconds
    );

    setTranscript('');
    setStudents(databaseService.getStudents());

    const successMsg = `Anotação salva na pasta de ${targetStudentName}!`;
    showToast(`✅ ${successMsg}`);

    if (settings.speakConfirmation) {
      soundEffectsService.speak(`Anotação de ${targetStudentName.split(' ')[0]} salva com sucesso.`);
    }
  };

  // Alternar microfone (com suporte oficial a expo-audio e transcrição automática no celular)
  const handleToggleMic = async () => {
    // Previne cliques múltiplos durante o salvamento ou finalização da gravação
    if (voiceState === 'saving' || nativeAudioService.isStoppingRecording()) {
      return;
    }

    if (voiceState === 'recording_dictation' || (Platform.OS !== 'web' && nativeAudioService.isRecording())) {
      if (Platform.OS !== 'web') {
        try {
          setVoiceState('saving');
          setTranscript('⏳ Finalizando gravação e transcrevendo áudio...');
          const { uri, durationMillis } = await nativeAudioService.stopRecording();
          if (uri) {
            const durationSec = Math.max(1, Math.round(durationMillis / 1000));
            showToast('⏳ Transcrevendo gravação em português...');

            const transResult = await transcriptionService.transcribeAudio(uri, durationSec);
            let finalNoteText = '';

            if (transResult.success && transResult.text) {
              finalNoteText = transResult.text;
              setTranscript(finalNoteText);
              setVoiceState('idle');

              // Verifica se a professora falou comandos como "Criar pasta do aluno..." ou "Anotar para..."
              const parsedCmd = speechRecognitionService.parseVoiceCommand(finalNoteText);
              if (parsedCmd.type === 'create_folder' && parsedCmd.studentName) {
                handleVoiceCommand(parsedCmd);
              } else if (parsedCmd.type === 'dictate_to_student' && parsedCmd.studentName) {
                handleVoiceCommand(parsedCmd);
                handleSaveNote(parsedCmd.content || finalNoteText, true, uri, durationSec);
              } else {
                handleSaveNote(finalNoteText, true, uri, durationSec);
              }
              soundEffectsService.playSaveSuccessChime();
            } else {
              setVoiceState('idle');
              finalNoteText = `Gravação de voz (${durationSec}s)`;
              handleSaveNote(finalNoteText, true, uri, durationSec);

              if (transResult.error === 'NO_KEY') {
                setTranscript('⚠️ Áudio salvo! Para transcrever a fala em texto automaticamente, configure sua chave gratuita do Groq no topo.');
                setIsTranscriptionModalOpen(true);
                setTimeout(() => {
                  showToast('🎙️ Configure sua chave gratuita do Groq para transcrição automática.');
                }, 600);
              } else {
                setTranscript(`⚠️ Áudio salvo na pasta, mas a transcrição falhou: ${transResult.error || 'Erro na API'}`);
                setTimeout(() => {
                  showToast(transResult.error || 'Áudio gravado e salvo na pasta.');
                }, 600);
              }
            }
          } else {
            setVoiceState('idle');
            showToast('Nenhum áudio foi capturado. Toque novamente para gravar.');
          }
        } catch (e: any) {
          setVoiceState('idle');
          showToast('Erro ao processar gravação: ' + (e?.message || 'erro inesperado'));
        } finally {
          if (settings.continuousListening) {
            setTimeout(() => {
              startOfflineWakeWord();
            }, 1200);
          }
        }
      } else {
        speechRecognitionService.stop();
        if (settings.continuousListening) {
          setTimeout(() => {
            startOfflineWakeWord();
          }, 1200);
        }
      }
    } else {
      stopOfflineWakeWord();
      if (Platform.OS !== 'web') {
        try {
          soundEffectsService.playWakeWordChime();
          setVoiceState('recording_dictation');
          setTranscript('🎙️ Gravando áudio pelo celular... Fale sua anotação agora.\nToque no botão central novamente para finalizar e transcrever.');
          const started = await nativeAudioService.startRecording();
          if (started) {
            showToast('🎙️ Gravando... Fale sua anotação e toque no microfone para transcrever.');
          }
        } catch (err: any) {
          setVoiceState('idle');
          showToast(err?.message || 'Permissão de microfone necessária.');
          if (settings.continuousListening) {
            setTimeout(() => {
              startOfflineWakeWord();
            }, 1000);
          }
        }
      } else {
        speechRecognitionService.startDictation();
      }
    }
  };

  // Iniciar detecção de palavra-chave offline ("Professora")
  const startOfflineWakeWord = async () => {
    if (voiceState === 'recording_dictation' || voiceState === 'saving') {
      return;
    }

    setVoiceState('listening_wake_word');
    await offlineWakeWordService.startListening({
      onDetected: (word, confidence) => {
        handleWakeWordTriggered(word, confidence);
      },
      onStateChange: (st) => {
        if (st === 'listening') {
          setVoiceState('listening_wake_word');
        } else if (st === 'error') {
          showToast('Permissão de microfone necessária para escuta contínua.');
        }
      },
    });
  };

  // Parar detecção de palavra-chave offline
  const stopOfflineWakeWord = () => {
    offlineWakeWordService.stopListening();
    if (voiceState === 'listening_wake_word') {
      setVoiceState('idle');
    }
  };

  // Disparo automático quando o usuário fala "Professora" offline
  const handleWakeWordTriggered = async (word: string, confidence: number) => {
    soundEffectsService.playWakeWordChime();
    showToast(`🎙️ "${word}" detectado offline (${confidence}%)! Gravando...`);

    // Pausa a escuta do wake word para liberar o microfone para a gravação da nota
    offlineWakeWordService.stopListening();

    setVoiceState('recording_dictation');
    setTranscript('🎙️ "Professora" detectado! Fale sua anotação agora.\nToque no botão central para finalizar e transcrever.');

    if (Platform.OS !== 'web') {
      try {
        await nativeAudioService.startRecording();
      } catch (err: any) {
        setVoiceState('idle');
        showToast(err?.message || 'Erro ao iniciar gravação.');
        if (settings.continuousListening) {
          startOfflineWakeWord();
        }
      }
    } else {
      speechRecognitionService.startDictation();
    }
  };

  // Alternar modo de escuta contínua por palavra-chave ("professora") 100% offline
  const handleToggleContinuousListening = async () => {
    const updated = !settings.continuousListening;
    const newSettings = databaseService.saveSettings({
      continuousListening: updated,
      offlineWakeWordEnabled: updated,
    });
    setSettings(newSettings);

    if (updated) {
      await startOfflineWakeWord();
      showToast('🟢 Escuta contínua offline ativada! Diga "Professora" para acionar.');
    } else {
      stopOfflineWakeWord();
      speechRecognitionService.stop();
      showToast('Escuta contínua desativada.');
    }
  };

  // Abrir e fechar modal de calibração liberando microfone
  const handleOpenCalibrationModal = () => {
    stopOfflineWakeWord();
    speechRecognitionService.stop();
    setIsCalibrationModalOpen(true);
  };

  const handleCloseCalibrationModal = () => {
    setIsCalibrationModalOpen(false);
    if (settings.continuousListening) {
      startOfflineWakeWord();
    }
  };

  // Adicionar Aluno Manualmente
  const handleCreateStudentManual = (name: string, grade: string) => {
    const created = databaseService.createStudentFolder(name, grade);
    const updatedList = databaseService.getStudents();
    setStudents(updatedList);
    setSelectedStudent(created);
    showToast(`Pasta de ${created.name} criada!`);
  };

  // Deletar Aluno
  const handleDeleteStudent = (studentId: string) => {
    databaseService.deleteStudentFolder(studentId);
    const updatedList = databaseService.getStudents();
    setStudents(updatedList);
    if (selectedStudent?.id === studentId) {
      setSelectedStudent(updatedList[0] || null);
    }
    showToast('Pasta excluída com sucesso.');
  };

  // Filtragem de alunos para a busca
  const filteredStudents = students.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.grade && s.grade.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const isRecording = voiceState === 'recording_dictation';
  const isListeningWakeWord = voiceState === 'listening_wake_word';

  return (
    <SafeAreaView style={styles.container}>
      {/* ===================== TOPO / CABEÇALHO ===================== */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerTitleContainer}>
            <View style={styles.logoBadge}>
              <Ionicons name="school" size={22} color="#fff" />
            </View>
            <View>
              <Text style={styles.headerTitle}>VozProfessora</Text>
              <Text style={styles.headerSubtitle}>
                Assistente de Voz & Diário de Bordo para Professoras
              </Text>
            </View>
          </View>

          {/* Badge de Status da Voz e Configuração */}
          <View style={styles.headerRightActions}>
            <TouchableOpacity
              style={[
                styles.wakeWordHeaderBtn,
                settings.continuousListening && styles.wakeWordHeaderBtnActive,
              ]}
              onPress={() => setIsWakeWordModalOpen(true)}
            >
              <Ionicons
                name="radio-outline"
                size={15}
                color={settings.continuousListening ? '#4ade80' : '#cbd5e1'}
              />
              <Text
                style={[
                  styles.wakeWordHeaderBtnText,
                  settings.continuousListening && styles.wakeWordHeaderBtnTextActive,
                ]}
              >
                Wake Word
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.transcriptionSettingsBtn}
              onPress={() => setIsTranscriptionModalOpen(true)}
            >
              <Ionicons
                name="settings-outline"
                size={15}
                color="#60a5fa"
              />
              <Text style={styles.transcriptionSettingsBtnText}>
                Transcrição
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.voiceProfileBtn}
              onPress={handleOpenCalibrationModal}
            >
              <Ionicons
                name={voiceProfile.calibrated ? 'finger-print' : 'finger-print-outline'}
                size={16}
                color={voiceProfile.calibrated ? '#4ade80' : '#facc15'}
              />
              <Text style={styles.voiceProfileBtnText}>
                {voiceProfile.calibrated ? 'Voz Calibrada' : 'Calibrar'}
              </Text>
            </TouchableOpacity>

            <View
              style={[
                styles.statusBadge,
                isRecording && styles.statusBadgeRecording,
                isListeningWakeWord && styles.statusBadgeWakeWord,
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: isRecording
                      ? '#ef4444'
                      : isListeningWakeWord
                      ? '#22c55e'
                      : '#94a3b8',
                  },
                ]}
              />
              <Text style={styles.statusText}>
                {isRecording
                  ? 'Gravando Ditado...'
                  : isListeningWakeWord
                  ? 'Aguardando "Professora"'
                  : 'Parado'}
              </Text>
            </View>
          </View>
        </View>

        {/* Abas de Navegação (Mobile ou Desktop) */}
        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'ditado' && styles.activeTab]}
            onPress={() => setActiveTab('ditado')}
          >
            <Ionicons
              name="mic"
              size={18}
              color={activeTab === 'ditado' ? '#15803d' : '#e2e8f0'}
            />
            <Text style={[styles.tabText, activeTab === 'ditado' && styles.activeTabText]}>
              Gravador / Ditado
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === 'pastas' && styles.activeTab]}
            onPress={() => setActiveTab('pastas')}
          >
            <Ionicons
              name="folder-open"
              size={18}
              color={activeTab === 'pastas' ? '#15803d' : '#e2e8f0'}
            />
            <Text style={[styles.tabText, activeTab === 'pastas' && styles.activeTabText]}>
              Pastas dos Alunos ({students.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ===================== NOTIFICAÇÃO TOAST ===================== */}
      {voiceNotification && (
        <View style={styles.toastContainer}>
          <Text style={styles.toastText}>{voiceNotification}</Text>
        </View>
      )}

      {/* ===================== CONTEÚDO PRINCIPAL ===================== */}
      <ScrollView contentContainerStyle={styles.contentContainer}>
        {/* Layout Desktop em 2 Colunas OU Abas no Mobile */}
        <View style={[styles.layoutWrapper, isDesktop && styles.layoutDesktop]}>
          {/* ----- COLUNA 1: GRAVADOR E DITADO POR VOZ ----- */}
          {(!isDesktop && activeTab === 'ditado') || isDesktop ? (
            <View style={[styles.column, isDesktop && styles.columnLeft]}>
              {/* Card Principal de Gravação */}
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>Controle de Voz da Professora</Text>
                  <TouchableOpacity
                    style={styles.calibrateLink}
                    onPress={handleOpenCalibrationModal}
                  >
                    <Ionicons name="options-outline" size={15} color="#15803d" />
                    <Text style={styles.calibrateLinkText}>Filtro de Ruídos</Text>
                  </TouchableOpacity>
                </View>

                {/* Seletor do Aluno Ativo */}
                <View style={styles.targetStudentSelector}>
                  <Text style={styles.targetLabel}>Salvando anotação na pasta de:</Text>
                  <TouchableOpacity
                    style={styles.selectedStudentPill}
                    onPress={() => setActiveTab('pastas')}
                  >
                    <Ionicons name="folder" size={16} color="#eab308" />
                    <Text style={styles.selectedStudentName}>
                      {selectedStudent ? selectedStudent.name : 'Nenhum aluno selecionado'}
                    </Text>
                    <Ionicons name="swap-horizontal" size={14} color="#64748b" />
                  </TouchableOpacity>
                </View>

                {/* Botão Central de Microfone */}
                <View style={styles.micCenterContainer}>
                  <TouchableOpacity
                    style={[
                      styles.micButton,
                      isRecording && styles.micButtonRecording,
                      isListeningWakeWord && styles.micButtonListening,
                      voiceState === 'saving' && styles.micButtonSaving,
                    ]}
                    onPress={handleToggleMic}
                    disabled={voiceState === 'saving'}
                    activeOpacity={0.8}
                  >
                    {voiceState === 'saving' ? (
                      <ActivityIndicator size="large" color="#fff" />
                    ) : (
                      <MaterialCommunityIcons
                        name={isRecording ? 'microphone' : 'microphone-outline'}
                        size={48}
                        color="#fff"
                      />
                    )}
                  </TouchableOpacity>
                  <Text style={styles.micStatusLabel}>
                    {voiceState === 'saving'
                      ? 'Processando áudio e transcrevendo...'
                      : isRecording
                      ? 'Gravando... Fale sua anotação e toque no microfone para transcrever'
                      : isListeningWakeWord
                      ? 'Aguardando palavra-chave "Professora"'
                      : 'Toque para ditar ou ative a palavra-chave'}
                  </Text>
                </View>

                {/* Visualizador de Ondas Sonoras e Filtro de Ruído */}
                <AudioVisualizer isActive={isRecording || isListeningWakeWord} />

                {/* Contagem Regressiva de 10s de Silêncio */}
                {isRecording && (
                  <CountdownTimer
                    remainingSeconds={remainingSilenceSeconds}
                    totalSeconds={settings.silenceTimeoutSeconds || 10}
                    onSaveNow={() => {
                      if (Platform.OS !== 'web') {
                        handleToggleMic();
                      } else {
                        handleSaveNote(transcript, true);
                        if (settings.continuousListening) {
                          setTimeout(() => {
                            startOfflineWakeWord();
                          }, 1200);
                        }
                      }
                    }}
                    onCancel={() => {
                      if (Platform.OS !== 'web') {
                        nativeAudioService.stopRecording().catch(() => {});
                        setVoiceState('idle');
                        setTranscript('');
                        if (settings.continuousListening) {
                          setTimeout(() => {
                            startOfflineWakeWord();
                          }, 600);
                        }
                      } else {
                        speechRecognitionService.stop();
                        setTranscript('');
                        if (settings.continuousListening) {
                          setTimeout(() => {
                            startOfflineWakeWord();
                          }, 600);
                        }
                      }
                    }}
                  />
                )}

                {/* Caixa de Transcrição em Tempo Real */}
                <View style={styles.transcriptBox}>
                  <View style={styles.transcriptHeader}>
                    <Text style={styles.transcriptLabel}>Transcrição em Tempo Real:</Text>
                    {isInterim && (
                      <View style={styles.liveIndicator}>
                        <View style={styles.liveDot} />
                        <Text style={styles.liveText}>Ao vivo</Text>
                      </View>
                    )}
                  </View>

                  <TextInput
                    style={styles.transcriptInput}
                    multiline
                    value={transcript}
                    onChangeText={setTranscript}
                    placeholder={
                      isRecording
                        ? 'Fale o que a professora dita (o texto aparecerá aqui automaticamente)...'
                        : 'O texto ditado pela professora aparecerá aqui. Você também pode digitar ou usar o microfone do teclado do celular.'
                    }
                    placeholderTextColor="#94a3b8"
                  />

                  {/* Dica de transcrição no celular */}
                  {Platform.OS !== 'web' && (
                    <TouchableOpacity
                      style={styles.mobileTipBanner}
                      onPress={() => setIsTranscriptionModalOpen(true)}
                    >
                      <Ionicons
                        name={settings.transcriptionApiKey ? 'checkmark-circle' : 'sparkles'}
                        size={17}
                        color={settings.transcriptionApiKey ? '#16a34a' : '#0284c7'}
                      />
                      <Text style={styles.mobileTipText}>
                        {settings.transcriptionApiKey
                          ? 'Transcrição inteligente ativa (Groq Whisper). Grave pelo celular e o áudio será transcrito automaticamente!'
                          : 'No celular: Toque aqui para configurar sua chave gratuita do Groq Whisper ou use o microfone do teclado do celular.'}
                      </Text>
                      <Ionicons name="chevron-forward" size={14} color="#0284c7" />
                    </TouchableOpacity>
                  )}

                  {transcript.trim().length > 0 && (
                    <View style={styles.transcriptActions}>
                      <TouchableOpacity
                        style={styles.clearBtn}
                        onPress={() => setTranscript('')}
                      >
                        <Ionicons name="trash-outline" size={15} color="#64748b" />
                        <Text style={styles.clearBtnText}>Limpar</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.saveTranscriptBtn}
                        onPress={() => handleSaveNote(transcript, true)}
                      >
                        <Ionicons name="save-outline" size={16} color="#fff" />
                        <Text style={styles.saveTranscriptBtnText}>
                          Salvar na Pasta de {selectedStudent?.name.split(' ')[0] || 'Aluno'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* Palavras-chave e Comandos Rápidos */}
                <View style={styles.commandsCard}>
                  <Text style={styles.commandsTitle}>
                    Palavras-chave de ativação automática:
                  </Text>
                  <View style={styles.keywordsWrap}>
                    {['"Professora"', '"Assistente"', '"Anotar"', '"Gravar"'].map((kw, i) => (
                      <View key={i} style={styles.keywordBadge}>
                        <Text style={styles.keywordText}>{kw}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={styles.voiceCommandTips}>
                    <Text style={styles.commandTipTitle}>Comandos de voz especiais:</Text>
                    <Text style={styles.commandTipItem}>
                      • <Text style={styles.boldText}>"Criar pasta do aluno Gabriel"</Text> → Cria
                      uma nova pasta automaticamente.
                    </Text>
                    <Text style={styles.commandTipItem}>
                      • <Text style={styles.boldText}>"Anotar para Ana: prestou muita atenção"</Text> →
                      Direciona a nota para Ana.
                    </Text>
                    <Text style={styles.commandTipItem}>
                      • <Text style={styles.boldText}>Silêncio por 10 segundos</Text> → Finaliza e
                      salva a anotação automaticamente.
                    </Text>
                  </View>

                  {/* Botão de Ativação Contínua */}
                  <TouchableOpacity
                    style={[
                      styles.continuousBtn,
                      settings.continuousListening && styles.continuousBtnActive,
                    ]}
                    onPress={handleToggleContinuousListening}
                  >
                    <Ionicons
                      name={settings.continuousListening ? 'radio-outline' : 'power-outline'}
                      size={18}
                      color={settings.continuousListening ? '#fff' : '#15803d'}
                    />
                    <Text
                      style={[
                        styles.continuousBtnText,
                        settings.continuousListening && styles.continuousBtnTextActive,
                      ]}
                    >
                      {settings.continuousListening
                        ? 'Escuta Contínua Ligada (Sempre alerta)'
                        : 'Ativar Escuta Contínua (Acionamento por voz)'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.wakeWordSettingsPill}
                    onPress={() => setIsWakeWordModalOpen(true)}
                  >
                    <View style={styles.wakeWordPillLeft}>
                      <Ionicons name="hardware-chip" size={15} color="#15803d" />
                      <Text style={styles.wakeWordSettingsPillText}>
                        Wake Word Offline: "Professora" ({settings.wakeWordSensitivity === 'alta' ? 'Sensibilidade Alta' : settings.wakeWordSensitivity === 'baixa' ? 'Sensibilidade Baixa' : 'Sensibilidade Média'})
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={15} color="#15803d" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : null}

          {/* ----- COLUNA 2: PASTAS DOS ALUNOS ----- */}
          {(!isDesktop && activeTab === 'pastas') || isDesktop ? (
            <View style={[styles.column, isDesktop && styles.columnRight]}>
              <View style={styles.card}>
                {/* Cabeçalho da Lista de Pastas */}
                <View style={styles.foldersHeader}>
                  <View>
                    <Text style={styles.cardTitle}>Pastas dos Alunos</Text>
                    <Text style={styles.cardSubtitle}>
                      {students.length} aluno{students.length !== 1 ? 's' : ''} cadastrado
                      {students.length !== 1 ? 's' : ''}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.newStudentBtn}
                    onPress={() => setIsNewStudentModalOpen(true)}
                  >
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={styles.newStudentBtnText}>Nova Pasta</Text>
                  </TouchableOpacity>
                </View>

                {/* Barra de Busca de Alunos */}
                <View style={styles.searchBar}>
                  <Ionicons name="search-outline" size={18} color="#94a3b8" />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Buscar aluno por nome ou turma..."
                    placeholderTextColor="#94a3b8"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                      <Ionicons name="close-circle" size={16} color="#94a3b8" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Lista de Pastas */}
                <View style={styles.foldersList}>
                  {filteredStudents.length === 0 ? (
                    <View style={styles.emptyFoldersBox}>
                      <Ionicons name="folder-open-outline" size={48} color="#cbd5e1" />
                      <Text style={styles.emptyFoldersTitle}>Nenhum aluno encontrado</Text>
                      <Text style={styles.emptyFoldersSub}>
                        Clique em "+ Nova Pasta" ou diga no microfone:{'\n'}
                        <Text style={styles.boldGreen}>"Criar pasta do aluno [Nome]"</Text>
                      </Text>
                    </View>
                  ) : (
                    filteredStudents.map((student) => (
                      <StudentFolderCard
                        key={student.id}
                        student={student}
                        isSelected={selectedStudent?.id === student.id}
                        onSelect={(st) => {
                          setSelectedStudent(st);
                          showToast(`Pasta de ${st.name} selecionada para ditado.`);
                        }}
                        onOpenDetails={(st) => {
                          setDetailsStudent(st);
                        }}
                      />
                    ))
                  )}
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* ===================== MODAIS ===================== */}
      {/* Modal de Novo Aluno Manual */}
      <NewStudentModal
        visible={isNewStudentModalOpen}
        onClose={() => setIsNewStudentModalOpen(false)}
        onCreate={handleCreateStudentManual}
      />

      {/* Modal de Calibração da Voz da Professora */}
      <VoiceCalibrationModal
        visible={isCalibrationModalOpen}
        onClose={handleCloseCalibrationModal}
        onProfileUpdated={(updatedProfile) => {
          setVoiceProfile(updatedProfile);
          showToast('Perfil de voz atualizado com sucesso no banco de dados!');
        }}
      />

      {/* Modal de Detalhes da Pasta do Aluno */}
      <StudentDetailsModal
        visible={!!detailsStudent}
        student={detailsStudent}
        notes={detailsStudent ? databaseService.getNotes(detailsStudent.id) : []}
        onClose={() => setDetailsStudent(null)}
        onAddNote={(studentId, studentName, text, category) => {
          databaseService.addNote(studentId, studentName, text, category, false);
          setStudents(databaseService.getStudents());
          showToast('Anotação adicionada com sucesso!');
        }}
        onDeleteNote={(noteId) => {
          databaseService.deleteNote(noteId);
          setStudents(databaseService.getStudents());
          showToast('Anotação excluída.');
        }}
        onDeleteStudent={(stId) => {
          handleDeleteStudent(stId);
        }}
        onStartVoiceForStudent={(st) => {
          setSelectedStudent(st);
          setActiveTab('ditado');
          if (Platform.OS !== 'web') {
            handleToggleMic();
          } else {
            speechRecognitionService.startDictation();
          }
        }}
        onOpenTranscriptionSettings={() => setIsTranscriptionModalOpen(true)}
        onNotesUpdated={() => setStudents(databaseService.getStudents())}
      />

      {/* Modal de Configuração de Transcrição */}
      <TranscriptionSettingsModal
        visible={isTranscriptionModalOpen}
        onClose={() => setIsTranscriptionModalOpen(false)}
        onSaved={(updated) => {
          setSettings(updated);
          showToast('Configurações de transcrição salvas!');
        }}
      />

      {/* Modal de Configuração de Wake Word Offline ("Professora") */}
      <WakeWordSettingsModal
        visible={isWakeWordModalOpen}
        onClose={() => setIsWakeWordModalOpen(false)}
        onSettingsUpdated={(updated) => {
          setSettings(updated);
          if (updated.continuousListening) {
            startOfflineWakeWord();
          } else {
            stopOfflineWakeWord();
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  // Header
  header: {
    backgroundColor: '#14532d', // Verde escuro elegante
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#166534',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
    gap: 10,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#16a34a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#bbf7d0',
    fontSize: 12,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  wakeWordHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
  },
  wakeWordHeaderBtnActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.25)',
    borderWidth: 1,
    borderColor: '#4ade80',
  },
  wakeWordHeaderBtnText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  wakeWordHeaderBtnTextActive: {
    color: '#86efac',
    fontWeight: 'bold',
  },
  transcriptionSettingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
  },
  transcriptionSettingsBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  voiceProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
  },
  voiceProfileBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 6,
  },
  statusBadgeRecording: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
  },
  statusBadgeWakeWord: {
    backgroundColor: 'rgba(34, 197, 94, 0.25)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  tabsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    gap: 6,
  },
  activeTab: {
    backgroundColor: '#fff',
  },
  tabText: {
    color: '#cbd5e1',
    fontWeight: '600',
    fontSize: 13,
  },
  activeTabText: {
    color: '#15803d',
  },
  // Toast
  toastContainer: {
    backgroundColor: '#1e293b',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  // Content & Layout
  contentContainer: {
    padding: 16,
  },
  layoutWrapper: {
    width: '100%',
  },
  layoutDesktop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  column: {
    width: '100%',
  },
  columnLeft: {
    flex: 1.1,
  },
  columnRight: {
    flex: 0.9,
  },
  // Cards
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  calibrateLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  calibrateLinkText: {
    fontSize: 12,
    color: '#15803d',
    fontWeight: '600',
  },
  // Target Student Selector
  targetStudentSelector: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  targetLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
    marginBottom: 4,
  },
  selectedStudentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectedStudentName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  // Mic Center
  micCenterContainer: {
    alignItems: 'center',
    marginVertical: 10,
  },
  micButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#15803d',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#15803d',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
    marginBottom: 10,
  },
  micButtonRecording: {
    backgroundColor: '#dc2626',
    shadowColor: '#dc2626',
  },
  micButtonListening: {
    backgroundColor: '#16a34a',
    borderWidth: 3,
    borderColor: '#bbf7d0',
  },
  micButtonSaving: {
    backgroundColor: '#0284c7',
    shadowColor: '#0284c7',
  },
  micStatusLabel: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    fontWeight: '500',
  },
  // Transcript Box
  transcriptBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    padding: 12,
    marginTop: 10,
    marginBottom: 16,
  },
  transcriptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  transcriptLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ef4444',
  },
  liveText: {
    fontSize: 11,
    color: '#ef4444',
    fontWeight: '600',
  },
  transcriptInput: {
    fontSize: 14,
    color: '#0f172a',
    minHeight: 70,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  mobileTipBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f0f9ff',
    borderWidth: 1,
    borderColor: '#bae6fd',
    borderRadius: 8,
    padding: 8,
    marginVertical: 6,
  },
  mobileTipText: {
    flex: 1,
    fontSize: 11,
    color: '#0369a1',
    lineHeight: 15,
  },
  transcriptActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 6,
  },
  clearBtnText: {
    fontSize: 12,
    color: '#64748b',
  },
  saveTranscriptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#15803d',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 6,
  },
  saveTranscriptBtnText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  // Commands Card
  commandsCard: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    padding: 14,
  },
  commandsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 8,
  },
  keywordsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  keywordBadge: {
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#86efac',
  },
  keywordText: {
    fontSize: 11,
    color: '#15803d',
    fontWeight: '600',
  },
  voiceCommandTips: {
    gap: 4,
    marginBottom: 12,
  },
  commandTipTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 2,
  },
  commandTipItem: {
    fontSize: 12,
    color: '#14532d',
    lineHeight: 18,
  },
  boldText: {
    fontWeight: '700',
  },
  boldGreen: {
    fontWeight: '700',
    color: '#15803d',
  },
  continuousBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#15803d',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  continuousBtnActive: {
    backgroundColor: '#15803d',
  },
  continuousBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#15803d',
  },
  continuousBtnTextActive: {
    color: '#fff',
  },
  wakeWordSettingsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
  },
  wakeWordPillLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  wakeWordSettingsPillText: {
    fontSize: 12,
    color: '#15803d',
    fontWeight: '600',
    flex: 1,
  },
  // Folders Header & Search
  foldersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  newStudentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#15803d',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 4,
  },
  newStudentBtnText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    marginBottom: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
  },
  foldersList: {
    gap: 4,
  },
  emptyFoldersBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyFoldersTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748b',
  },
  emptyFoldersSub: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
  },
});