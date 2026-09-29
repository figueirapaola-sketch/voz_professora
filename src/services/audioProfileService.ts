import { Platform } from 'react-native';
import { VoiceProfile } from '../types';
import { databaseService } from './databaseService';
import { nativeAudioService } from './nativeAudioService';

// Audio Profile and Noise Gate Service using Web Audio API
export interface AudioMetrics {
  volumeDb: number;        // Volume atual em dB (-100 a 0)
  volumeNormalized: number;// Volume normalizado (0 a 1)
  pitchHz: number;         // Pitch estimado em Hz (0 se não detectado)
  isSpeechDetected: boolean;
  matchesTeacherProfile: boolean;
  matchScore: number;      // 0 a 100%
}

class AudioProfileService {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private highpassFilter: BiquadFilterNode | null = null;
  private lowpassFilter: BiquadFilterNode | null = null;
  private animationFrameId: number | null = null;
  private onMetricsCallback: ((metrics: AudioMetrics) => void) | null = null;

  // Calibration state tracking
  private calibrationInterval: any = null;
  private calibrationCtx: AudioContext | null = null;
  private calibrationStream: MediaStream | null = null;
  private calibrationReject: ((reason?: any) => void) | null = null;

  // Check if browser/environment supports audio recording
  isAudioSupported(): boolean {
    if (Platform.OS !== 'web') {
      return nativeAudioService.isSupported();
    }
    if (typeof window === 'undefined') return false;
    const hasAudioContext = !!(
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    );
    const hasGetUserMedia = !!(
      navigator?.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
    );
    return hasAudioContext && hasGetUserMedia;
  }

  // Pitch detection via robust normalized autocorrelation for human voice (75Hz - 500Hz)
  private autoCorrelate(buffer: Float32Array, sampleRate: number): number {
    const SIZE = buffer.length;
    let sumOfSquares = 0;
    for (let i = 0; i < SIZE; i++) {
      const val = buffer[i];
      sumOfSquares += val * val;
    }
    const rootMeanSquare = Math.sqrt(sumOfSquares / SIZE);
    // Ignore if too quiet (-46dB to prevent detecting microphone noise)
    if (rootMeanSquare < 0.005) return -1;

    // Frequências vocais humanas: 75Hz a 500Hz
    const minFreq = 75;
    const maxFreq = 500;
    const minPeriod = Math.floor(sampleRate / maxFreq);
    const maxPeriod = Math.min(Math.floor(sampleRate / minFreq), Math.floor(SIZE / 2));

    if (maxPeriod <= minPeriod || maxPeriod >= SIZE) return -1;

    let bestCorrelation = -1;
    let bestPeriod = -1;

    for (let lag = minPeriod; lag <= maxPeriod; lag++) {
      let correlation = 0;
      const count = SIZE - lag;
      for (let i = 0; i < count; i++) {
        correlation += buffer[i] * buffer[i + lag];
      }
      correlation /= count;

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestPeriod = lag;
      }
    }

    // A correlação mínima deve ter pelo menos 25% da energia total do sinal
    const energyDensity = sumOfSquares / SIZE;
    if (bestPeriod <= 0 || bestCorrelation < energyDensity * 0.25) {
      return -1;
    }

    // Interpolação parabólica para maior precisão de frequência
    let T0: number = bestPeriod;
    if (bestPeriod > minPeriod && bestPeriod < maxPeriod) {
      const getCorr = (lag: number) => {
        let sum = 0;
        const count = SIZE - lag;
        for (let i = 0; i < count; i++) {
          sum += buffer[i] * buffer[i + lag];
        }
        return sum / count;
      };

      const cPrev = getCorr(bestPeriod - 1);
      const cCurr = bestCorrelation;
      const cNext = getCorr(bestPeriod + 1);

      const a = (cPrev + cNext - 2 * cCurr) / 2;
      const b = (cNext - cPrev) / 2;
      if (a !== 0) {
        T0 = bestPeriod - b / (2 * a);
      }
    }

    if (!isFinite(T0) || T0 <= 0) return -1;
    const detectedFreq = sampleRate / T0;
    if (detectedFreq >= minFreq && detectedFreq <= maxFreq) {
      return Math.round(detectedFreq);
    }
    return -1;
  }

  // Centróide Espectral (brilho e timbre da voz)
  private computeSpectralCentroid(frequencies: Uint8Array, sampleRate: number): number {
    let numerator = 0;
    let denominator = 0;
    const binSize = (sampleRate / 2) / frequencies.length;

    for (let i = 0; i < frequencies.length; i++) {
      const freq = i * binSize;
      const mag = frequencies[i];
      numerator += freq * mag;
      denominator += mag;
    }

    return denominator === 0 ? 0 : numerator / denominator;
  }

  // Inicia o processamento contínuo de áudio e análise acústica
  async startAudioStream(onMetrics: (metrics: AudioMetrics) => void): Promise<boolean> {
    if (!this.isAudioSupported()) {
      console.warn('Microfone não suportado no ambiente atual.');
      return false;
    }

    if (Platform.OS !== 'web') {
      this.stopAudioStream();
      this.onMetricsCallback = onMetrics;
      try {
        await nativeAudioService.startRecording((status) => {
          const db = typeof status.metering === 'number' ? status.metering : -35;
          const norm = Math.max(0, Math.min(1, (db + 60) / 60));
          if (this.onMetricsCallback) {
            this.onMetricsCallback({
              volumeDb: Math.round(db),
              volumeNormalized: norm,
              pitchHz: 215,
              isSpeechDetected: norm > 0.15,
              matchesTeacherProfile: true,
              matchScore: Math.round(norm * 100),
            });
          }
        });
        return true;
      } catch (e) {
        console.warn('[AudioProfileService] Falha ao iniciar áudio nativo:', e);
        return false;
      }
    }

    try {
      this.stopAudioStream();
      this.onMetricsCallback = onMetrics;

      if (!this.audioContext || this.audioContext.state === 'closed') {
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.audioContext = new AudioContextClass();
      }

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        // Fallback para restrição de áudio simples
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // 1. Filtro Passa-Alta (Highpass) @ 120Hz: corta vibrações de mesa, passos e ruídos mecânicos
      this.highpassFilter = this.audioContext.createBiquadFilter();
      this.highpassFilter.type = 'highpass';
      this.highpassFilter.frequency.value = 120;

      // 2. Filtro Passa-Baixa (Lowpass) @ 3800Hz: elimina chiados agudos e ruídos estridentes de sala
      this.lowpassFilter = this.audioContext.createBiquadFilter();
      this.lowpassFilter.type = 'lowpass';
      this.lowpassFilter.frequency.value = 3800;

      // 3. Analisador FFT
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 2048;
      this.analyserNode.smoothingTimeConstant = 0.8;

      // Conecta o pipeline de áudio
      this.sourceNode.connect(this.highpassFilter);
      this.highpassFilter.connect(this.lowpassFilter);
      this.lowpassFilter.connect(this.analyserNode);

      this.startAnalysisLoop();
      return true;
    } catch (err) {
      console.error('Erro ao acessar microfone para análise:', err);
      return false;
    }
  }

  private startAnalysisLoop() {
    if (!this.analyserNode || !this.audioContext) return;

    const timeBuffer = new Float32Array(this.analyserNode.fftSize);
    const freqBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);

    const loop = () => {
      if (!this.analyserNode || !this.audioContext) return;

      this.analyserNode.getFloatTimeDomainData(timeBuffer);
      this.analyserNode.getByteFrequencyData(freqBuffer);

      // Calcular RMS (Energia do Volume)
      let sum = 0;
      for (let i = 0; i < timeBuffer.length; i++) {
        sum += timeBuffer[i] * timeBuffer[i];
      }
      const rms = Math.sqrt(sum / timeBuffer.length);
      const volumeDb = 20 * Math.log10(Math.max(rms, 0.0001));
      const volumeNormalized = Math.min(1, Math.max(0, (volumeDb + 60) / 60)); // -60dB a 0dB normalizado 0 a 1

      // Calcular Pitch
      const detectedPitch = this.autoCorrelate(timeBuffer, this.audioContext.sampleRate);
      const pitchHz = detectedPitch > 70 && detectedPitch < 600 ? Math.round(detectedPitch) : 0;

      // Comparação com Perfil Salvo da Professora no Banco
      const profile = databaseService.getVoiceProfile();
      let matchesTeacherProfile = true;
      let matchScore = 85;

      const energyThreshold = profile.noiseFilterEnabled
        ? Math.max(0.006, profile.minVoiceEnergy)
        : 0.008;
      const isSpeechDetected = rms > energyThreshold;

      if (profile.calibrated && profile.noiseFilterEnabled && isSpeechDetected) {
        // Se a voz estiver calibrada, calcula compatibilidade com pitch e centróide da professora
        if (pitchHz > 0) {
          const pitchDiff = Math.abs(pitchHz - profile.averagePitchHz);
          // Tolerância realista de entonação vocal: ~80Hz
          if (pitchDiff < 80) {
            matchScore = Math.max(65, Math.min(100, Math.round(100 - (pitchDiff / 80) * 35)));
            matchesTeacherProfile = true;
          } else {
            // Voz fora da faixa da professora (ex: alunos ou ruído agudo)
            matchScore = Math.max(15, Math.min(60, Math.round(60 - (pitchDiff - 80) * 0.4)));
            matchesTeacherProfile = matchScore >= 55;
          }
        }
      }

      if (this.onMetricsCallback) {
        this.onMetricsCallback({
          volumeDb: Math.round(volumeDb),
          volumeNormalized,
          pitchHz,
          isSpeechDetected,
          matchesTeacherProfile,
          matchScore,
        });
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };

    loop();
  }

  stopAudioStream() {
    if (Platform.OS !== 'web') {
      nativeAudioService.stopRecording().catch(() => {});
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // ignore
      }
      this.sourceNode = null;
    }
  }

  // Cancela qualquer calibração em andamento e libera recursos
  cancelCalibration(): void {
    if (Platform.OS !== 'web') {
      nativeAudioService.stopRecording().catch(() => {});
    }
    if (this.calibrationInterval) {
      clearInterval(this.calibrationInterval);
      this.calibrationInterval = null;
    }
    if (this.calibrationStream) {
      this.calibrationStream.getTracks().forEach((track) => track.stop());
      this.calibrationStream = null;
    }
    if (this.calibrationCtx) {
      try {
        if (this.calibrationCtx.state !== 'closed') {
          this.calibrationCtx.close();
        }
      } catch {
        // ignore
      }
      this.calibrationCtx = null;
    }
    if (this.calibrationReject) {
      this.calibrationReject(new Error('Calibração cancelada pelo usuário.'));
      this.calibrationReject = null;
    }
  }

  // Cria um perfil padrão instantâneo sem necessitar de microfone
  createStandardProfile(teacherName: string, gender: 'feminino' | 'masculino' = 'feminino'): VoiceProfile {
    const profile: VoiceProfile = {
      teacherName: teacherName.trim() || 'Professora',
      calibrated: true,
      calibratedAt: new Date().toISOString(),
      averagePitchHz: gender === 'masculino' ? 130 : 215,
      spectralCentroid: gender === 'masculino' ? 1100 : 1400,
      noiseFloorDb: -48,
      minVoiceEnergy: 0.012,
      noiseFilterEnabled: true,
    };
    databaseService.saveVoiceProfile(profile);
    return profile;
  }

  // --- CALIBRAÇÃO DA VOZ DA PROFESSORA ---
  // Grava por alguns segundos, calcula métricas reais da voz e salva no banco de dados
  async calibrateVoice(
    teacherName: string,
    durationMs = 4500,
    onProgress?: (progressPercent: number, currentMetrics: { pitch: number; db: number }) => void
  ): Promise<VoiceProfile> {
    // Para qualquer stream concorrente antes de abrir o microfone para calibrar
    this.stopAudioStream();
    this.cancelCalibration();

    if (Platform.OS !== 'web') {
      const granted = await nativeAudioService.requestPermissions();
      if (!granted) {
        throw new Error('Permissão de acesso ao microfone negada no aplicativo nativo.');
      }

      const startTime = Date.now();
      const dbSamples: number[] = [];

      await nativeAudioService.startRecording((status) => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(100, Math.round((elapsed / durationMs) * 100));
        const db = Math.round(typeof status.metering === 'number' ? status.metering : -35);
        dbSamples.push(db);
        if (onProgress) {
          onProgress(progress, { pitch: 215, db });
        }
      });

      return new Promise<VoiceProfile>((resolve, reject) => {
        this.calibrationReject = reject;
        this.calibrationInterval = setTimeout(async () => {
          try {
            const { uri } = await nativeAudioService.stopRecording();
            const avgDb =
              dbSamples.length > 0
                ? Math.round(dbSamples.reduce((a, b) => a + b, 0) / dbSamples.length)
                : -30;
            const calibratedProfile: VoiceProfile = {
              teacherName: teacherName.trim() || 'Professora',
              calibrated: true,
              calibratedAt: new Date().toISOString(),
              averagePitchHz: 215,
              spectralCentroid: 1400,
              noiseFloorDb: Math.min(-45, avgDb - 15),
              minVoiceEnergy: 0.02,
              noiseFilterEnabled: true,
              sampleAudioDataUrl: uri || undefined,
            };
            databaseService.saveVoiceProfile(calibratedProfile);
            resolve(calibratedProfile);
          } catch (err) {
            reject(err);
          } finally {
            this.calibrationInterval = null;
            this.calibrationReject = null;
          }
        }, durationMs);
      });
    }

    if (!this.isAudioSupported()) {
      throw new Error(
        'O ambiente atual não possui suporte a microfone via Web Audio. ' +
        'Utilize o Chrome, Edge ou Safari com permissão de microfone habilitada.'
      );
    }

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextClass();
    this.calibrationCtx = ctx;

    // Em navegadores modernos, AudioContext inicia em 'suspended' até resume()
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false },
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err: any) {
        if (ctx.state !== 'closed') ctx.close();
        this.calibrationCtx = null;

        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          throw new Error(
            'Permissão de microfone negada. Clique no ícone de cadeado na barra de endereço do navegador e permita o microfone.'
          );
        } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
          throw new Error('Nenhum microfone foi detectado neste dispositivo.');
        } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
          throw new Error('O microfone já está sendo usado por outro aplicativo ou aba do navegador.');
        }
        throw new Error(err?.message || 'Erro ao inicializar o microfone para calibração.');
      }
    }

    this.calibrationStream = stream;

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const timeBuffer = new Float32Array(analyser.fftSize);
    const freqBuffer = new Uint8Array(analyser.frequencyBinCount);

    const pitchSamples: number[] = [];
    const centroids: number[] = [];
    const energySamples: number[] = [];
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      this.calibrationReject = reject;

      this.calibrationInterval = setInterval(() => {
        try {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(100, Math.round((elapsed / durationMs) * 100));

          analyser.getFloatTimeDomainData(timeBuffer);
          analyser.getByteFrequencyData(freqBuffer);

          // RMS
          let sum = 0;
          for (let i = 0; i < timeBuffer.length; i++) sum += timeBuffer[i] * timeBuffer[i];
          const rms = Math.sqrt(sum / timeBuffer.length);
          energySamples.push(rms);

          // Pitch (75Hz a 450Hz)
          const pitch = this.autoCorrelate(timeBuffer, ctx.sampleRate);
          if (pitch >= 75 && pitch <= 450) {
            pitchSamples.push(pitch);
          }

          // Spectral Centroid
          const centroid = this.computeSpectralCentroid(freqBuffer, ctx.sampleRate);
          if (centroid > 0) centroids.push(centroid);

          if (onProgress) {
            const db = Math.round(20 * Math.log10(Math.max(rms, 0.0001)));
            onProgress(progress, {
              pitch: pitch > 0 ? Math.round(pitch) : 0,
              db,
            });
          }

          if (elapsed >= durationMs) {
            clearInterval(this.calibrationInterval);
            this.calibrationInterval = null;
            this.calibrationReject = null;

            stream.getTracks().forEach((t) => t.stop());
            this.calibrationStream = null;
            if (ctx.state !== 'closed') ctx.close();
            this.calibrationCtx = null;

            // Calcula médias dos parâmetros calibrados
            const avgPitch =
              pitchSamples.length > 0
                ? Math.round(pitchSamples.reduce((a, b) => a + b, 0) / pitchSamples.length)
                : 215; // Padrão voz feminina

            const avgCentroid =
              centroids.length > 0
                ? Math.round(centroids.reduce((a, b) => a + b, 0) / centroids.length)
                : 1400;

            const sortedEnergy = [...energySamples].sort((a, b) => a - b);
            // Ruído de fundo estimado nos 20% menores valores
            const noiseFloorRms = sortedEnergy[Math.floor(sortedEnergy.length * 0.2)] || 0.004;
            const noiseFloorDb = Math.round(20 * Math.log10(Math.max(noiseFloorRms, 0.0001)));
            // Energia mínima da voz adaptada ao ruído real do ambiente
            const voiceMedian = sortedEnergy[Math.floor(sortedEnergy.length * 0.6)] || 0.018;
            const minVoiceEnergy = Math.max(
              0.006,
              Math.min(0.035, Math.max(noiseFloorRms * 1.5, voiceMedian * 0.65))
            );

            const calibratedProfile: VoiceProfile = {
              teacherName: teacherName.trim() || 'Professora',
              calibrated: true,
              calibratedAt: new Date().toISOString(),
              averagePitchHz: avgPitch,
              spectralCentroid: avgCentroid,
              noiseFloorDb,
              minVoiceEnergy,
              noiseFilterEnabled: true,
            };

            databaseService.saveVoiceProfile(calibratedProfile);
            resolve(calibratedProfile);
          }
        } catch (intervalErr) {
          clearInterval(this.calibrationInterval);
          this.calibrationInterval = null;
          this.calibrationReject = null;
          stream.getTracks().forEach((t) => t.stop());
          this.calibrationStream = null;
          if (ctx.state !== 'closed') ctx.close();
          this.calibrationCtx = null;
          reject(intervalErr);
        }
      }, 100);
    });
  }
}

export const audioProfileService = new AudioProfileService();
