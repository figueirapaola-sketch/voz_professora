import { Platform } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  createAudioPlayer,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from 'expo-audio';
import type { AudioPlayer, AudioRecorder } from 'expo-audio';

export interface NativeAudioStatus {
  isRecording: boolean;
  durationMillis: number;
  uri: string | null;
  metering?: number;
}

/**
 * Converte as opções de preset para o formato plano esperado pela camada nativa de cada plataforma
 * (Android MediaRecorder / iOS AVAudioRecorder / Web MediaRecorder).
 */
function getPlatformRecordingOptions(options: any) {
  const commonOptions = {
    extension: options.extension || '.m4a',
    sampleRate: options.sampleRate || 44100,
    numberOfChannels: options.numberOfChannels || 2,
    bitRate: options.bitRate || 128000,
    isMeteringEnabled: options.isMeteringEnabled ?? false,
    directory: options.directory,
  };

  if (Platform.OS === 'ios') {
    return {
      ...commonOptions,
      ...options.ios,
    };
  } else if (Platform.OS === 'android') {
    return {
      ...commonOptions,
      outputFormat: options.android?.outputFormat || 'mpeg4',
      audioEncoder: options.android?.audioEncoder || 'aac',
      ...options.android,
    };
  } else {
    return {
      ...commonOptions,
      mimeType: options.web?.mimeType || 'audio/webm',
      bitsPerSecond: options.web?.bitsPerSecond || 128000,
      ...options.web,
    };
  }
}

class NativeAudioService {
  private recorder: AudioRecorder | null = null;
  private player: AudioPlayer | null = null;
  private isCurrentlyRecording = false;
  private isStarting = false;
  private isStopping = false;
  private recordingStartTime = 0;
  private currentDurationMillis = 0;
  private currentStopPromise: Promise<{ uri: string | null; durationMillis: number }> | null = null;
  private lastRecordedUri: string | null = null;
  private statusSubscription: { remove: () => void } | null = null;
  private playerStatusSubscription: { remove: () => void } | null = null;
  private onStatusCallback: ((status: NativeAudioStatus) => void) | null = null;

  /**
   * Verifica se o ambiente nativo ou web suporta captura de microfone via expo-audio.
   */
  isSupported(): boolean {
    return !!(AudioModule && AudioModule.AudioRecorder);
  }

  /**
   * Solicita permissão de gravação no microfone para Android, iOS e Web.
   */
  async requestPermissions(): Promise<boolean> {
    try {
      const response = await requestRecordingPermissionsAsync();
      return !!response.granted;
    } catch (e) {
      console.warn('[NativeAudioService] Erro ao solicitar permissão de microfone:', e);
      return false;
    }
  }

  /**
   * Checa se a permissão já foi concedida.
   */
  async hasPermissions(): Promise<boolean> {
    try {
      const response = await getRecordingPermissionsAsync();
      return !!response.granted;
    } catch (e) {
      console.warn('[NativeAudioService] Erro ao checar permissão de microfone:', e);
      return false;
    }
  }

  /**
   * Configura a sessão de áudio para permitir gravação e reprodução sem interrupção.
   */
  async configureAudioMode(): Promise<void> {
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'doNotMix',
      });
    } catch (e) {
      console.warn('[NativeAudioService] Erro ao configurar modo de áudio:', e);
    }
  }

  /**
   * Inicia a gravação de áudio do microfone usando expo-audio com proteção anti-concorrência.
   */
  async startRecording(
    onStatusUpdate?: (status: NativeAudioStatus) => void
  ): Promise<boolean> {
    if (this.isStarting) {
      return false;
    }
    this.isStarting = true;

    try {
      // 1. Garante permissões de microfone
      let granted = await this.hasPermissions();
      if (!granted) {
        granted = await this.requestPermissions();
      }
      if (!granted) {
        throw new Error('Permissão de acesso ao microfone foi negada.');
      }

      // 2. Para qualquer gravação ou reprodução em andamento
      if (this.isCurrentlyRecording || this.recorder) {
        await this.stopRecording();
      }
      await this.stopPlayback();

      // 3. Ativa o subsistema global de áudio
      try {
        await setIsAudioActiveAsync(true);
      } catch {
        // ignore
      }

      // 4. Configura a sessão nativa de áudio
      await this.configureAudioMode();

      // 5. Prepara opções compatíveis com a plataforma atual (achata opções para o Android/iOS)
      const platformOptions = getPlatformRecordingOptions(RecordingPresets.HIGH_QUALITY);

      // 6. Instancia o AudioRecorder com as opções corretas
      const recorder = new AudioModule.AudioRecorder(platformOptions);
      this.recorder = recorder;
      this.onStatusCallback = onStatusUpdate || null;
      this.currentDurationMillis = 0;

      // 7. Configura listener de atualização de status
      if (recorder.addListener) {
        this.statusSubscription = recorder.addListener(
          'recordingStatusUpdate',
          (_status: any) => {
            try {
              if (!this.recorder) return;
              const state = this.recorder.getStatus();
              const currentDuration =
                state?.durationMillis || (Date.now() - this.recordingStartTime);
              this.currentDurationMillis = currentDuration;
              if (this.recorder.uri) {
                this.lastRecordedUri = this.recorder.uri;
              }
              if (this.onStatusCallback) {
                this.onStatusCallback({
                  isRecording: state?.isRecording ?? this.isCurrentlyRecording,
                  durationMillis: currentDuration,
                  uri: this.recorder.uri || this.lastRecordedUri,
                  metering: state?.metering,
                });
              }
            } catch {
              // ignore
            }
          }
        );
      }

      // 8. Prepara e inicia a gravação nativa
      await recorder.prepareToRecordAsync(platformOptions);

      if (recorder.uri) {
        this.lastRecordedUri = recorder.uri;
      }

      recorder.record();

      this.isCurrentlyRecording = true;
      this.recordingStartTime = Date.now();
      this.currentDurationMillis = 0;

      return true;
    } catch (e: any) {
      console.error('[NativeAudioService] Falha ao iniciar gravação:', e);
      this.cleanUpRecorder();
      throw e;
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Para a gravação de áudio com proteção contra reentrância e leitura segura da URI gravada.
   */
  async stopRecording(): Promise<{ uri: string | null; durationMillis: number }> {
    // Se já estiver em processo de parada, retorna a promise em voo para evitar concorrência
    if (this.currentStopPromise) {
      return this.currentStopPromise;
    }

    if (!this.recorder && !this.isCurrentlyRecording) {
      return { uri: this.lastRecordedUri, durationMillis: this.currentDurationMillis };
    }

    this.currentStopPromise = this.performStopRecording();
    try {
      const result = await this.currentStopPromise;
      return result;
    } finally {
      this.currentStopPromise = null;
    }
  }

  private async performStopRecording(): Promise<{ uri: string | null; durationMillis: number }> {
    this.isStopping = true;
    const recorder = this.recorder;

    // Desmarca flag imediatamente para barrar chamadas subsequentes
    this.isCurrentlyRecording = false;

    if (!recorder) {
      this.isStopping = false;
      return { uri: this.lastRecordedUri, durationMillis: this.currentDurationMillis };
    }

    try {
      // 1. Armazena URI prévia caso a plataforma limpe a propriedade ao parar
      let finalUri = recorder.uri || this.lastRecordedUri;

      // 2. Proteção para Android MediaRecorder: necessita de tempo mínimo (~800ms) para não lançar RuntimeException
      const elapsed = Date.now() - this.recordingStartTime;
      if (elapsed < 800) {
        await new Promise((resolve) => setTimeout(resolve, 800 - elapsed));
      }

      // 3. Para o gravador nativo
      try {
        await recorder.stop();
      } catch (stopErr) {
        console.warn('[NativeAudioService] Aviso durante recorder.stop():', stopErr);
      }

      // 4. Captura URI final
      if (recorder.uri) {
        finalUri = recorder.uri;
      }
      if (!finalUri) {
        finalUri = this.lastRecordedUri;
      }

      const durationMillis =
        this.currentDurationMillis || (Date.now() - this.recordingStartTime);

      this.lastRecordedUri = finalUri;
      this.cleanUpRecorder();

      return {
        uri: finalUri,
        durationMillis,
      };
    } catch (e) {
      console.warn('[NativeAudioService] Erro ao parar gravação:', e);
      const fallbackUri = recorder?.uri || this.lastRecordedUri;
      this.cleanUpRecorder();
      return { uri: fallbackUri, durationMillis: this.currentDurationMillis };
    } finally {
      this.isStopping = false;
    }
  }

  /**
   * Reproduz um arquivo de áudio gravado nativamente.
   */
  async playAudio(uri: string, onFinished?: () => void): Promise<void> {
    try {
      await this.stopPlayback();

      // Configura modo de áudio para reprodução
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });

      const player = createAudioPlayer(uri);
      this.player = player;

      if (player.addListener) {
        this.playerStatusSubscription = player.addListener('playbackStatusUpdate', (status) => {
          if (status.didJustFinish) {
            this.stopPlayback();
            onFinished?.();
          }
        });
      }

      player.play();
    } catch (e) {
      console.error('[NativeAudioService] Erro ao reproduzir áudio:', e);
      this.cleanUpPlayer();
      throw e;
    }
  }

  /**
   * Para a reprodução atual.
   */
  async stopPlayback(): Promise<void> {
    if (this.player) {
      try {
        this.player.pause();
        this.player.remove();
      } catch (e) {
        // ignore
      }
      this.cleanUpPlayer();
    }
  }

  isRecording(): boolean {
    return this.isCurrentlyRecording;
  }

  isStoppingRecording(): boolean {
    return this.isStopping;
  }

  isStartingRecording(): boolean {
    return this.isStarting;
  }

  isPlaying(): boolean {
    return !!(this.player && this.player.playing);
  }

  getLastRecordedUri(): string | null {
    return this.lastRecordedUri;
  }

  private cleanUpRecorder() {
    this.isCurrentlyRecording = false;
    if (this.statusSubscription) {
      try {
        this.statusSubscription.remove();
      } catch {
        // ignore
      }
      this.statusSubscription = null;
    }
    this.recorder = null;
    this.onStatusCallback = null;
  }

  private cleanUpPlayer() {
    if (this.playerStatusSubscription) {
      try {
        this.playerStatusSubscription.remove();
      } catch {
        // ignore
      }
      this.playerStatusSubscription = null;
    }
    this.player = null;
  }
}

export const nativeAudioService = new NativeAudioService();
