import { Platform } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  RecordingStatus,
  createAudioPlayer,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import type { AudioPlayer, AudioRecorder } from 'expo-audio';

export interface NativeAudioStatus {
  isRecording: boolean;
  durationMillis: number;
  uri: string | null;
  metering?: number;
}

class NativeAudioService {
  private recorder: AudioRecorder | null = null;
  private player: AudioPlayer | null = null;
  private isCurrentlyRecording = false;
  private recordingStartTime = 0;
  private currentDurationMillis = 0;
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
   * Inicia a gravação de áudio do microfone usando expo-audio.
   */
  async startRecording(
    onStatusUpdate?: (status: NativeAudioStatus) => void
  ): Promise<boolean> {
    try {
      // 1. Garante permissões
      const granted = await this.requestPermissions();
      if (!granted) {
        throw new Error('Permissão de acesso ao microfone foi negada.');
      }

      // 2. Para qualquer gravação ou reprodução em andamento
      await this.stopRecording();
      await this.stopPlayback();

      // 3. Configura a sessão nativa de áudio
      await this.configureAudioMode();

      // 4. Instancia o AudioRecorder com o preset oficial de alta qualidade
      const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
      this.recorder = recorder;
      this.onStatusCallback = onStatusUpdate || null;

      // 5. Escuta os status de gravação
      if (recorder.addListener) {
        this.statusSubscription = recorder.addListener(
          'recordingStatusUpdate',
          (_status: RecordingStatus) => {
            try {
              const state = recorder.getStatus();
              const currentDuration = state?.durationMillis || (Date.now() - this.recordingStartTime);
              this.currentDurationMillis = currentDuration;
              if (this.onStatusCallback) {
                this.onStatusCallback({
                  isRecording: state?.isRecording ?? this.isCurrentlyRecording,
                  durationMillis: currentDuration,
                  uri: recorder.uri,
                  metering: state?.metering,
                });
              }
            } catch {
              // ignore
            }
          }
        );
      }

      // 6. Prepara e inicia a gravação
      await recorder.prepareToRecordAsync();
      recorder.record();

      this.isCurrentlyRecording = true;
      this.recordingStartTime = Date.now();
      this.currentDurationMillis = 0;

      return true;
    } catch (e: any) {
      console.error('[NativeAudioService] Falha ao iniciar gravação:', e);
      this.cleanUpRecorder();
      throw e;
    }
  }

  /**
   * Para a gravação de áudio e retorna o caminho do arquivo gravado e a duração total.
   */
  async stopRecording(): Promise<{ uri: string | null; durationMillis: number }> {
    if (!this.recorder || !this.isCurrentlyRecording) {
      return { uri: null, durationMillis: 0 };
    }

    try {
      await this.recorder.stop();
      const finalUri = this.recorder.uri;
      const durationMillis = this.currentDurationMillis || (Date.now() - this.recordingStartTime);

      this.cleanUpRecorder();

      return {
        uri: finalUri,
        durationMillis,
      };
    } catch (e) {
      console.warn('[NativeAudioService] Erro ao parar gravação:', e);
      this.cleanUpRecorder();
      return { uri: null, durationMillis: 0 };
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

  isPlaying(): boolean {
    return !!(this.player && this.player.playing);
  }

  private cleanUpRecorder() {
    this.isCurrentlyRecording = false;
    if (this.statusSubscription) {
      this.statusSubscription.remove();
      this.statusSubscription = null;
    }
    this.recorder = null;
    this.onStatusCallback = null;
  }

  private cleanUpPlayer() {
    if (this.playerStatusSubscription) {
      this.playerStatusSubscription.remove();
      this.playerStatusSubscription = null;
    }
    this.player = null;
  }
}

export const nativeAudioService = new NativeAudioService();
