import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { databaseService } from '../services/databaseService';
import { transcriptionService } from '../services/transcriptionService';
import { SystemSettings } from '../types';

interface TranscriptionSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved?: (settings: SystemSettings) => void;
}

export const TranscriptionSettingsModal: React.FC<TranscriptionSettingsModalProps> = ({
  visible,
  onClose,
  onSaved,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<'groq' | 'openai' | 'custom'>('groq');
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [securityLabel, setSecurityLabel] = useState(databaseService.getSecurityLabel());
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (visible) {
      setSecurityLabel(databaseService.getSecurityLabel());
      const current = databaseService.getSettings();
      setApiKey(current.transcriptionApiKey || '');
      setProvider(current.transcriptionProvider || 'groq');
      setTestResult(null);
      setSavedSuccess(false);

      // Carrega a chave de forma assíncrona do armazenamento seguro nativo/web
      databaseService.getSecureTranscriptionKey().then((secKey) => {
        if (secKey) {
          setApiKey(secKey);
        }
      });
    }
  }, [visible]);

  const handleSave = async () => {
    setIsSaving(true);
    // Salva a chave com criptografia segura no armazenamento local (Keystore / Keychain / Web Crypto)
    await databaseService.saveSecureTranscriptionKey(apiKey.trim());

    const updated = databaseService.saveSettings({
      transcriptionApiKey: apiKey.trim(),
      transcriptionProvider: provider,
    });
    setIsSaving(false);
    setSavedSuccess(true);
    onSaved?.(updated);
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  const handleDeleteKey = async () => {
    await databaseService.deleteSecureTranscriptionKey();
    setApiKey('');
    const updated = databaseService.saveSettings({
      transcriptionApiKey: '',
    });
    setTestResult({
      success: true,
      message: 'Chave removida com segurança do dispositivo.',
    });
    onSaved?.(updated);
  };

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      setTestResult({
        success: false,
        message: 'Insira a chave de API antes de testar.',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    const res = await transcriptionService.testConnection(apiKey.trim(), provider === 'custom' ? 'groq' : provider);
    setIsTesting(false);
    setTestResult(res);
  };

  const handleOpenGroqConsole = () => {
    Linking.openURL('https://console.groq.com/keys').catch(() => {});
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Cabeçalho */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <Ionicons name="sparkles" size={20} color="#2563eb" />
              </View>
              <View>
                <Text style={styles.title}>Transcrição no Celular</Text>
                <Text style={styles.subtitle}>Configuração do Reconhecimento de Áudio</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Status Atual */}
            <View
              style={[
                styles.statusBox,
                apiKey ? styles.statusBoxActive : styles.statusBoxWarning,
              ]}
            >
              <Ionicons
                name={apiKey ? 'checkmark-circle' : 'information-circle'}
                size={22}
                color={apiKey ? '#16a34a' : '#d97706'}
              />
              <View style={styles.statusTextBox}>
                <Text style={[styles.statusTitle, { color: apiKey ? '#15803d' : '#b45309' }]}>
                  {apiKey
                    ? 'Transcrição Automática Ativa!'
                    : 'Transcrição no celular requer chave gratuita'}
                </Text>
                <Text style={styles.statusDescription}>
                  {apiKey
                    ? 'Seus áudios gravados no celular serão transcritos instantaneamente para texto em português.'
                    : 'No celular, a gravação de áudio precisa ser transcrita via Whisper (Groq ou OpenAI). O serviço do Groq é 100% gratuito e rápido.'}
                </Text>
              </View>
            </View>

            {/* Banner de Armazenamento Seguro Criptografado no Banco Local */}
            <View style={styles.secureStorageBanner}>
              <View style={styles.secureHeader}>
                <Ionicons name="shield-checkmark" size={17} color="#16a34a" />
                <Text style={styles.secureTitle}>Armazenamento Seguro no Dispositivo</Text>
              </View>
              <Text style={styles.secureDesc}>
                Sua chave é salva com criptografia no banco de dados local do seu aparelho ({securityLabel}). Ela nunca é exposta em texto puro e permanece protegida no hardware seguro.
              </Text>
            </View>

            {/* Seleção de Provedor */}
            <Text style={styles.label}>Provedor de Transcrição:</Text>
            <View style={styles.providerRow}>
              <TouchableOpacity
                style={[
                  styles.providerBtn,
                  provider === 'groq' && styles.providerBtnActive,
                ]}
                onPress={() => setProvider('groq')}
              >
                <Text
                  style={[
                    styles.providerBtnText,
                    provider === 'groq' && styles.providerBtnTextActive,
                  ]}
                >
                  Groq Whisper (Grátis & Rápido)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.providerBtn,
                  provider === 'openai' && styles.providerBtnActive,
                ]}
                onPress={() => setProvider('openai')}
              >
                <Text
                  style={[
                    styles.providerBtnText,
                    provider === 'openai' && styles.providerBtnTextActive,
                  ]}
                >
                  OpenAI Whisper
                </Text>
              </TouchableOpacity>
            </View>

            {/* Campo da Chave */}
            <Text style={styles.label}>
              Chave de API {provider === 'groq' ? 'Groq (gsk_...)' : 'OpenAI (sk-...)'}:
            </Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder={provider === 'groq' ? 'Ex: gsk_xxxxxxxx...' : 'Ex: sk-proj-...'}
                placeholderTextColor="#94a3b8"
                value={apiKey}
                onChangeText={setApiKey}
                secureTextEntry={!showKey}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowKey(!showKey)}
              >
                <Ionicons
                  name={showKey ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color="#64748b"
                />
              </TouchableOpacity>
            </View>

            {/* Botão de Testar e Remover Chave */}
            <View style={styles.testRow}>
              <TouchableOpacity
                style={styles.testBtn}
                onPress={handleTestKey}
                disabled={isTesting}
              >
                {isTesting ? (
                  <ActivityIndicator size="small" color="#2563eb" />
                ) : (
                  <>
                    <Ionicons name="flash-outline" size={15} color="#2563eb" />
                    <Text style={styles.testBtnText}>Testar Chave</Text>
                  </>
                )}
              </TouchableOpacity>

              {apiKey.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.deleteKeyBtn}
                  onPress={handleDeleteKey}
                >
                  <Ionicons name="trash-outline" size={15} color="#dc2626" />
                  <Text style={styles.deleteKeyBtnText}>Remover Chave</Text>
                </TouchableOpacity>
              )}
            </View>

            {testResult && (
              <View style={styles.testFeedback}>
                <Ionicons
                  name={testResult.success ? 'checkmark-circle' : 'alert-circle'}
                  size={16}
                  color={testResult.success ? '#16a34a' : '#ef4444'}
                />
                <Text
                  style={[
                    styles.testFeedbackText,
                    { color: testResult.success ? '#16a34a' : '#ef4444' },
                  ]}
                >
                  {testResult.message}
                </Text>
              </View>
            )}

            {/* Como Obter a Chave Gratuita */}
            <View style={styles.guideCard}>
              <Text style={styles.guideTitle}>💡 Como obter sua chave gratuita do Groq (leva 30 segundos):</Text>
              <Text style={styles.guideStep}>
                1. Abra o site oficial gratuito do Groq:
              </Text>
              <TouchableOpacity style={styles.linkBtn} onPress={handleOpenGroqConsole}>
                <Ionicons name="open-outline" size={14} color="#2563eb" />
                <Text style={styles.linkBtnText}>Abrir console.groq.com/keys</Text>
              </TouchableOpacity>
              <Text style={styles.guideStep}>
                2. Entre com sua conta Google ou crie uma conta gratuita.
              </Text>
              <Text style={styles.guideStep}>
                3. Clique no botão <Text style={styles.bold}>"Create API Key"</Text>, dê qualquer nome e copie o código gerado.
              </Text>
              <Text style={styles.guideStep}>
                4. Cole a chave no campo acima e clique em <Text style={styles.bold}>"Salvar com Segurança"</Text>.
              </Text>
            </View>

            {/* Dica alternativa do teclado */}
            <View style={styles.keyboardTipCard}>
              <Ionicons name="mic-circle-outline" size={20} color="#0891b2" />
              <View style={{ flex: 1 }}>
                <Text style={styles.keyboardTipTitle}>Dica rápida sem chave de API:</Text>
                <Text style={styles.keyboardTipDesc}>
                  Você também pode usar o microfone integrado no teclado do seu celular (Gboard no Android ou Teclado Apple no iPhone) clicando na caixa de transcrição para ditar diretamente em tempo real!
                </Text>
              </View>
            </View>
          </ScrollView>

          {/* Rodapé com botões de ação */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={isSaving}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="shield-checkmark" size={17} color="#fff" />
              )}
              <Text style={styles.saveBtnText}>
                {savedSuccess ? 'Salvo com Segurança!' : 'Salvar com Segurança'}
              </Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    width: '100%',
    maxWidth: 540,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
  },
  content: {
    padding: 20,
  },
  statusBox: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 12,
    gap: 12,
    marginBottom: 12,
  },
  secureStorageBanner: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  secureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  secureTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#15803d',
  },
  secureDesc: {
    fontSize: 11,
    color: '#166534',
    lineHeight: 16,
  },
  statusBoxActive: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  statusBoxWarning: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  statusTextBox: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  statusDescription: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 17,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  providerRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  providerBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
  },
  providerBtnActive: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  providerBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748b',
  },
  providerBtnTextActive: {
    color: '#1d4ed8',
    fontWeight: '700',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    height: 42,
    fontSize: 14,
    color: '#0f172a',
  },
  eyeBtn: {
    padding: 6,
  },
  testRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#eff6ff',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  testBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563eb',
  },
  deleteKeyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fef2f2',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  deleteKeyBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
  testFeedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
  },
  testFeedbackText: {
    fontSize: 12,
    fontWeight: '500',
  },
  guideCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 14,
  },
  guideTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 6,
  },
  guideStep: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
    marginTop: 4,
  },
  bold: {
    fontWeight: '700',
    color: '#0f172a',
  },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    marginBottom: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#eff6ff',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  linkBtnText: {
    fontSize: 12,
    color: '#2563eb',
    fontWeight: '600',
  },
  keyboardTipCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#ecfeff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#a5f3fc',
    marginBottom: 8,
  },
  keyboardTipTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0e7490',
    marginBottom: 2,
  },
  keyboardTipDesc: {
    fontSize: 11,
    color: '#155e75',
    lineHeight: 16,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#f8fafc',
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  cancelBtnText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  saveBtnText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  saveBtnDisabled: {
    opacity: 0.65,
  },
});
