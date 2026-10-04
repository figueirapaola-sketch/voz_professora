import { Platform } from 'react-native';
import {
  AudioModule,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import type { AudioStreamBuffer } from 'expo-audio/build/AudioStream.types';
import { databaseService } from './databaseService';

export interface WakeWordMetrics {
  volumeDb: number;
  isSpeechDetected: boolean;
  confidenceScore: number;
  detectedWord?: string;
}

export type WakeWordState = 'idle' | 'listening' | 'detected' | 'error';

// Padrão acústico-fonético de referência para a palavra "PROFESSORA"
// 12 fatias temporais (tempo normalizado de ~900ms) x 5 bandas de frequência:
// Banda 0: 100 - 450 Hz (F0 / Vogais baixas [o], [u])
// Banda 1: 450 - 1100 Hz (Formante F1 [o], [e], [a])
// Banda 2: 1100 - 2800 Hz (Formante F2 / ressonância de [r], [l])
// Banda 3: 2800 - 5200 Hz (Fricativa [f] / início de sibilância)
// Banda 4: 5200 - 8000 Hz (Sibilância intensa do duplo 's' em [so])
const TARGET_PROFESSORA_MATRIX: number[][] = [
  // Slice 0-2: "PRO" [p-r-o] -> Ataque plosivo com energia em graves e médios
  [0.75, 0.65, 0.40, 0.15, 0.08],
  [0.85, 0.80, 0.55, 0.20, 0.10],
  [0.70, 0.75, 0.50, 0.25, 0.12],

  // Slice 3-5: "FES" [f-e-s] -> Fricativa 'f' e primeiro pico sibilante 's'
  [0.35, 0.55, 0.70, 0.85, 0.65],
  [0.30, 0.60, 0.75, 0.90, 0.80],
  [0.40, 0.70, 0.80, 0.85, 0.75],

  // Slice 6-8: "SO" [s-o] -> Sibilância máxima (duplo s) seguida de vogal 'o'
  [0.25, 0.50, 0.70, 0.95, 0.92],
  [0.45, 0.75, 0.65, 0.80, 0.70],
  [0.60, 0.85, 0.60, 0.45, 0.30],

  // Slice 9-11: "RA" [r-a] -> Consoante vibrante suave e vogal aberta final [a]
  [0.70, 0.80, 0.55, 0.25, 0.12],
  [0.75, 0.85, 0.60, 0.20, 0.08],
  [0.45, 0.50, 0.35, 0.12, 0.05],
];

// Limiares de sensibilidade
const SENSITIVITY_THRESHOLDS = {
  alta: 0.62,   // Detecta facilmente mesmo de longe
  media: 0.72,  // Equilíbrio ideal para sala de aula (padrão)
  baixa: 0.82,  // Exige pronúncia muito nítida (evita falsos positivos em barulho)
};

class OfflineWakeWordService {
  private isListening = false;
  private state: WakeWordState = 'idle';
  private nativeStream: any = null;
  private streamSubscription: { remove: () => void } | null = null;
  private webAudioCtx: any = null;
  private webMediaStream: any = null;
  private webProcessor: any = null;
  private webAnalyser: any = null;

  // Buffer de áudio temporal para análise de fala (Voice Activity Detection - VAD)
  private speechFrames: number[][] = [];
  private isSpeechActive = false;
  private silenceFramesCount = 0;
  private speechStartTime = 0;

  // Controle de cooldown após disparo
  private lastTriggerTime = 0;
  private cooldownMs = 2500;

  // Callbacks
  private onDetectedCallback: ((word: string, confidence: number) => void) | null = null;
  private onStateChangeCallback: ((state: WakeWordState) => void) | null = null;
  private onMetricsCallback: ((metrics: WakeWordMetrics) => void) | null = null;

  /**
   * Verifica se o microfone está disponível no dispositivo.
   */
  async checkPermissions(): Promise<boolean> {
    try {
      const status = await getRecordingPermissionsAsync();
      if (status.granted) return true;
      const req = await requestRecordingPermissionsAsync();
      return !!req.granted;
    } catch {
      return false;
    }
  }

  /**
   * Inicia a escuta contínua offline pela palavra-chave "Professora".
   */
  async startListening(options?: {
    onDetected?: (word: string, confidence: number) => void;
    onStateChange?: (state: WakeWordState) => void;
    onMetrics?: (metrics: WakeWordMetrics) => void;
  }): Promise<boolean> {
    if (this.isListening) {
      return true;
    }

    if (options?.onDetected) this.onDetectedCallback = options.onDetected;
    if (options?.onStateChange) this.onStateChangeCallback = options.onStateChange;
    if (options?.onMetrics) this.onMetricsCallback = options.onMetrics;

    const granted = await this.checkPermissions();
    if (!granted) {
      this.setState('error');
      console.warn('[OfflineWakeWordService] Permissão de microfone negada.');
      return false;
    }

    this.speechFrames = [];
    this.isSpeechActive = false;
    this.silenceFramesCount = 0;

    let started = false;
    if (Platform.OS !== 'web') {
      started = await this.startNativeStream();
    } else {
      started = await this.startWebStream();
    }

    if (started) {
      this.isListening = true;
      this.setState('listening');
    } else {
      this.setState('error');
    }

    return started;
  }

  /**
   * Para a escuta de wake word e libera os recursos do microfone.
   */
  stopListening(): void {
    this.isListening = false;
    this.setState('idle');

    // Libera stream nativo
    if (this.nativeStream) {
      try {
        if (this.streamSubscription) {
          this.streamSubscription.remove();
          this.streamSubscription = null;
        }
        this.nativeStream.stop();
      } catch (e) {
        // ignore
      }
      this.nativeStream = null;
    }

    // Libera stream web
    if (this.webProcessor) {
      try {
        this.webProcessor.disconnect();
      } catch {
        // ignore
      }
      this.webProcessor = null;
    }
    if (this.webAnalyser) {
      try {
        this.webAnalyser.disconnect();
      } catch {
        // ignore
      }
      this.webAnalyser = null;
    }
    if (this.webMediaStream) {
      try {
        this.webMediaStream.getTracks().forEach((track: any) => track.stop());
      } catch {
        // ignore
      }
      this.webMediaStream = null;
    }
    if (this.webAudioCtx && this.webAudioCtx.state !== 'closed') {
      try {
        this.webAudioCtx.close();
      } catch {
        // ignore
      }
      this.webAudioCtx = null;
    }
  }

  getState(): WakeWordState {
    return this.state;
  }

  isCurrentlyListening(): boolean {
    return this.isListening;
  }

  private setState(newState: WakeWordState) {
    this.state = newState;
    this.onStateChangeCallback?.(newState);
  }

  // =========================================================================
  // CAPTURA NATIVA VIA EXPO-AUDIO AUDIOSTREAM (100% OFFLINE)
  // =========================================================================
  private async startNativeStream(): Promise<boolean> {
    try {
      if (AudioModule && (AudioModule as any).AudioStream) {
        const stream = new (AudioModule as any).AudioStream({
          sampleRate: 16000,
          channels: 1,
          encoding: 'float32',
        });
        this.nativeStream = stream;

        this.streamSubscription = stream.addListener(
          'audioStreamBuffer',
          (buffer: AudioStreamBuffer) => {
            if (!this.isListening) return;
            this.handleAudioBufferData(buffer.data, buffer.sampleRate || 16000);
          }
        );

        await stream.start();
        return true;
      }

      console.warn('[OfflineWakeWordService] AudioStream não disponível nesta plataforma nativa.');
      return false;
    } catch (e) {
      console.warn('[OfflineWakeWordService] Falha ao iniciar AudioStream nativo:', e);
      return false;
    }
  }

  // =========================================================================
  // CAPTURA WEB VIA WEB AUDIO API (100% OFFLINE NO NAVEGADOR)
  // =========================================================================
  private async startWebStream(): Promise<boolean> {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }

    try {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate: 16000 });
      this.webAudioCtx = ctx;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      this.webMediaStream = stream;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      this.webAnalyser = analyser;

      // ScriptProcessor para ler os buffers PCM puros
      const processor = ctx.createScriptProcessor(512, 1, 1);
      this.webProcessor = processor;

      processor.onaudioprocess = (event) => {
        if (!this.isListening) return;
        const inputData = event.inputBuffer.getChannelData(0);
        this.handleAudioBufferData(inputData, ctx.sampleRate);
      };

      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(ctx.destination);

      return true;
    } catch (e) {
      console.warn('[OfflineWakeWordService] Falha ao iniciar stream Web Audio:', e);
      return false;
    }
  }

  // =========================================================================
  // PROCESSAMENTO DE BUFFER DE ÁUDIO & EXTRAÇÃO DE CARACTERÍSTICAS (DSP)
  // =========================================================================
  private handleAudioBufferData(data: ArrayBuffer | Float32Array, sampleRate: number) {
    if (Date.now() - this.lastTriggerTime < this.cooldownMs) {
      return; // Em cooldown após ativação
    }

    let samples: Float32Array;
    if (data instanceof Float32Array) {
      samples = data;
    } else if (data instanceof ArrayBuffer) {
      samples = new Float32Array(data);
    } else {
      return;
    }

    if (!samples || samples.length === 0) return;

    // 1. Calcula Energia RMS e ZCR (Taxa de Cruzamento por Zero)
    let sumSquares = 0;
    let zeroCrossings = 0;
    const len = samples.length;

    for (let i = 0; i < len; i++) {
      const val = samples[i];
      sumSquares += val * val;
      if (i > 0 && ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0))) {
        zeroCrossings++;
      }
    }

    const rms = Math.sqrt(sumSquares / len);
    const volumeDb = Math.max(-80, Math.round(20 * Math.log10(Math.max(rms, 0.0001))));
    const zcr = zeroCrossings / len;

    // 2. Extração espectral em 5 bandas de frequência (bancos de filtro mel-like)
    const bandEnergies = this.computeBandEnergies(samples, sampleRate);

    // 3. VAD (Detecção de Atividade de Voz): limiar adaptativo
    const voiceEnergyThreshold = 0.015; // ~ -36dB
    const isVoiceFrame = rms > voiceEnergyThreshold;

    this.onMetricsCallback?.({
      volumeDb,
      isSpeechDetected: isVoiceFrame,
      confidenceScore: 0,
    });

    if (isVoiceFrame) {
      if (!this.isSpeechActive) {
        this.isSpeechActive = true;
        this.speechFrames = [];
        this.speechStartTime = Date.now();
      }
      this.silenceFramesCount = 0;
      this.speechFrames.push([...bandEnergies, zcr, rms]);
    } else if (this.isSpeechActive) {
      this.silenceFramesCount++;
      // Adiciona até 3 frames de silêncio para captar final da fala
      if (this.silenceFramesCount <= 3) {
        this.speechFrames.push([...bandEnergies, zcr, rms]);
      }

      // Se detectou 6 frames consecutivos de silêncio (~180ms), a elocução terminou
      if (this.silenceFramesCount >= 6) {
        this.evaluateSpeechSegment();
        this.isSpeechActive = false;
        this.speechFrames = [];
      }
    }
  }

  /**
   * Divide o espectro de frequências em 5 bandas críticas para a fonética de "PROFESSORA".
   */
  private computeBandEnergies(samples: Float32Array, sampleRate: number): number[] {
    const N = Math.min(256, samples.length);
    // Aplica transformada rápida simplificada de Goertzel/DFT para as bandas fonéticas
    const bands = [
      { min: 100, max: 450 },   // Banda 0: Graves / F0
      { min: 450, max: 1100 },  // Banda 1: Formante F1
      { min: 1100, max: 2800 }, // Banda 2: Formante F2
      { min: 2800, max: 5200 }, // Banda 3: Fricativa [f]
      { min: 5200, max: 8000 }, // Banda 4: Sibilância [s], [ss]
    ];

    const energies = [0, 0, 0, 0, 0];

    // Aproximação de energia por banda espectral no domínio temporal via filtro passa-faixa
    for (let b = 0; b < bands.length; b++) {
      const { min, max } = bands[b];
      const centerFreq = (min + max) / 2;
      const omega = (2 * Math.PI * centerFreq) / sampleRate;
      let cosVal = Math.cos(omega);
      let coeff = 2 * cosVal;
      let sPrev = 0;
      let sPrev2 = 0;

      for (let i = 0; i < N; i++) {
        const s = samples[i] + coeff * sPrev - sPrev2;
        sPrev2 = sPrev;
        sPrev = s;
      }
      const power = sPrev2 * sPrev2 + sPrev * sPrev - coeff * sPrev * sPrev2;
      energies[b] = Math.max(0, Math.sqrt(Math.max(0, power)) / N);
    }

    // Normaliza para soma = 1
    const total = energies.reduce((a, b) => a + b, 0) || 1;
    return energies.map((e) => Math.min(1, (e / total) * 1.5));
  }

  // =========================================================================
  // RECONHECIMENTO DE PADRÃO OFFLINE (DYNAMIC TIME WARPING / CORRELAÇÃO)
  // =========================================================================
  private evaluateSpeechSegment() {
    const frameCount = this.speechFrames.length;
    const durationMs = Date.now() - this.speechStartTime;

    // A palavra "Professora" pronunciada em ritmo normal dura entre 600ms e 1600ms
    if (durationMs < 550 || durationMs > 1750 || frameCount < 12) {
      return;
    }

    // Normaliza a sequência temporal de frames para 12 fatias uniformes
    const normalizedMatrix: number[][] = [];
    const step = (frameCount - 1) / (TARGET_PROFESSORA_MATRIX.length - 1);

    for (let i = 0; i < TARGET_PROFESSORA_MATRIX.length; i++) {
      const targetIdx = Math.round(i * step);
      const frame = this.speechFrames[Math.min(targetIdx, frameCount - 1)];
      // Pega as 5 energias de banda
      normalizedMatrix.push(frame.slice(0, 5));
    }

    // Compara a matriz temporal com o modelo de referência de "PROFESSORA"
    const score = this.calculateSimilarity(normalizedMatrix, TARGET_PROFESSORA_MATRIX);

    // Verificação de características fonéticas indispensáveis da palavra "Professora":
    // 1. Presença marcante de sibilância no meio/fim ("feSSo" -> fatias 4 a 8)
    const midSibilance =
      (normalizedMatrix[5][4] + normalizedMatrix[6][4] + normalizedMatrix[7][4]) / 3;
    const initialGraves =
      (normalizedMatrix[0][0] + normalizedMatrix[1][0] + normalizedMatrix[2][0]) / 3;

    // Bônus se apresentar o padrão clássico: início em graves ("pro") e meio com forte sibilância ("sso")
    let finalScore = score;
    if (midSibilance > 0.40 && initialGraves > 0.35) {
      finalScore = Math.min(1.0, finalScore * 1.15);
    }

    const settings = databaseService.getSettings();
    const sensitivity = settings.wakeWordSensitivity || 'media';
    const threshold = SENSITIVITY_THRESHOLDS[sensitivity] || 0.72;

    const confidencePercent = Math.round(finalScore * 100);

    this.onMetricsCallback?.({
      volumeDb: -20,
      isSpeechDetected: true,
      confidenceScore: confidencePercent,
    });

    if (finalScore >= threshold) {
      this.triggerWakeWord('professora', confidencePercent);
    }
  }

  /**
   * Calcula a similaridade de cosseno ponderada entre as trajetórias temporais.
   */
  private calculateSimilarity(matrixA: number[][], matrixB: number[][]): number {
    let totalScore = 0;
    const slices = Math.min(matrixA.length, matrixB.length);

    for (let i = 0; i < slices; i++) {
      const vecA = matrixA[i];
      const vecB = matrixB[i];

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let j = 0; j < vecA.length; j++) {
        dotProduct += vecA[j] * vecB[j];
        normA += vecA[j] * vecA[j];
        normB += vecB[j] * vecB[j];
      }

      const denominator = Math.sqrt(normA) * Math.sqrt(normB);
      const sliceCosine = denominator > 0 ? dotProduct / denominator : 0;
      totalScore += sliceCosine;
    }

    return totalScore / slices;
  }

  /**
   * Aciona a detecção da palavra-chave offline.
   */
  private triggerWakeWord(word: string, confidence: number) {
    this.lastTriggerTime = Date.now();
    this.setState('detected');

    console.log(`[OfflineWakeWordService] 🎙️ Wake Word "${word}" detectada offline! Confiança: ${confidence}%`);

    if (this.onDetectedCallback) {
      this.onDetectedCallback(word, confidence);
    }

    // Retorna para escuta após pequeno intervalo se continuar ativo
    setTimeout(() => {
      if (this.isListening) {
        this.setState('listening');
      }
    }, 1500);
  }
}

export const offlineWakeWordService = new OfflineWakeWordService();
