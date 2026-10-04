import { VoiceCommandDetection, VoiceState } from '../types';
import { databaseService } from './databaseService';
import { soundEffectsService } from './soundEffectsService';

export interface SpeechRecognitionCallbacks {
  onStateChange: (state: VoiceState) => void;
  onTranscriptChange: (transcript: string, isInterim: boolean) => void;
  onCountdownTick: (remainingSeconds: number) => void;
  onVoiceCommand: (command: VoiceCommandDetection) => void;
  onAutoFinalize: (finalTranscript: string) => void;
  onError: (errorMessage: string) => void;
}

// Interface tipada para a Web Speech API
interface IWindowSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

class SpeechRecognitionService {
  private recognition: IWindowSpeechRecognition | null = null;
  private state: VoiceState = 'idle';
  private callbacks: SpeechRecognitionCallbacks | null = null;
  private currentTranscript = '';
  private interimTranscript = '';
  private countdownTimer: any = null;
  private remainingSeconds = 10;
  private isUserInitiatedStop = false;
  private restartTimeout: any = null;

  // Wake words aceitas
  private wakeWords = ['professora', 'assistente', 'anotar', 'gravar', 'caderno', 'ei professora'];

  constructor() {
    this.initRecognition();
  }

  public checkIsMobile(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 2)
    );
  }

  private initRecognition(): boolean {
    if (typeof window === 'undefined') return false;

    const SpeechRec =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRec) {
      console.warn('SpeechRecognition não suportado neste navegador/ambiente.');
      return false;
    }

    try {
      if (this.recognition) {
        try {
          this.recognition.abort();
        } catch {
          // ignore
        }
      }

      const rec = new SpeechRec();
      const isMobile = this.checkIsMobile();

      // Navegadores móveis (Chrome no Android e Safari no iOS) falham/fecham imediatamente com continuous: true.
      // Em celulares, usamos continuous: false e encadeamos os resultados suavemente no onend.
      rec.continuous = !isMobile;
      rec.interimResults = true;
      rec.lang = 'pt-BR';
      rec.maxAlternatives = 1;

      rec.onresult = (event: any) => this.handleResult(event);
      rec.onerror = (event: any) => this.handleError(event);
      rec.onend = () => this.handleEnd();
      rec.onstart = () => {
        // Recognition started
      };

      this.recognition = rec;
      return true;
    } catch (e) {
      console.error('Erro ao instanciar SpeechRecognition:', e);
      return false;
    }
  }

  isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  setCallbacks(callbacks: SpeechRecognitionCallbacks) {
    this.callbacks = callbacks;
  }

  getState(): VoiceState {
    return this.state;
  }

  private setState(newState: VoiceState) {
    this.state = newState;
    this.callbacks?.onStateChange(newState);
  }

  // Inicia a escuta contínua no modo Palavra-Chave ("Standby")
  async startWakeWordListening() {
    this.initRecognition();
    if (!this.recognition) {
      this.callbacks?.onError('Reconhecimento de voz não suportado pelo navegador.');
      return;
    }

    // Em celular, solicita permissão de microfone se necessário
    if (this.checkIsMobile() && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        // ignora se já concedido ou negado
      }
    }

    this.isUserInitiatedStop = false;
    this.currentTranscript = '';
    this.interimTranscript = '';
    this.clearCountdown();
    this.setState('listening_wake_word');

    try {
      this.recognition.start();
    } catch (e: any) {
      if (e.name !== 'InvalidStateError') {
        console.warn('Erro ao iniciar reconhecimento:', e);
      }
    }
  }

  // Ativa manualmente o ditado (ex: clicando no microfone)
  async startDictation() {
    soundEffectsService.playWakeWordChime();
    this.currentTranscript = '';
    this.interimTranscript = '';
    this.callbacks?.onTranscriptChange('', false);
    this.setState('recording_dictation');
    this.resetSilenceCountdown();

    this.initRecognition();

    if (this.checkIsMobile() && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (err: any) {
        console.warn('Microphone permission check:', err);
      }
    }

    try {
      this.isUserInitiatedStop = false;
      this.recognition?.start();
    } catch (e: any) {
      if (e.name !== 'InvalidStateError') {
        console.warn('Erro ao iniciar ditado:', e);
      }
    }
  }

  // Para completamente o microfone
  stop() {
    this.isUserInitiatedStop = true;
    this.clearCountdown();
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    try {
      this.recognition?.stop();
    } catch {
      // ignore
    }
    this.setState('idle');
  }

  // Gerencia o temporizador de silêncio
  private resetSilenceCountdown() {
    this.clearCountdown();

    const settings = databaseService.getSettings();
    this.remainingSeconds = settings.silenceTimeoutSeconds || 10;
    this.callbacks?.onCountdownTick(this.remainingSeconds);

    this.countdownTimer = setInterval(() => {
      this.remainingSeconds -= 1;
      this.callbacks?.onCountdownTick(this.remainingSeconds);

      if (this.remainingSeconds <= 3 && this.remainingSeconds > 0) {
        soundEffectsService.playTick();
      }

      if (this.remainingSeconds <= 0) {
        this.clearCountdown();
        this.finalizeDictation();
      }
    }, 1000);
  }

  private clearCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  // Finaliza a anotação automaticamente após silêncio ou por comando
  finalizeDictation() {
    this.clearCountdown();
    const finalNote = (this.currentTranscript + ' ' + this.interimTranscript).trim();

    this.setState('saving');
    this.currentTranscript = '';
    this.interimTranscript = '';

    if (finalNote.length > 0) {
      soundEffectsService.playSaveSuccessChime();
      this.callbacks?.onAutoFinalize(finalNote);
    }

    // Volta para o modo de espera por palavra-chave se escuta contínua estiver ativada
    setTimeout(() => {
      const settings = databaseService.getSettings();
      if (settings.continuousListening && !this.isUserInitiatedStop) {
        this.startWakeWordListening();
      } else {
        this.setState('idle');
      }
    }, 1200);
  }

  // Processa o fluxo de fala do navegador
  private handleResult(event: any) {
    let interim = '';
    let finalChunk = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const item = event.results[i];
      const text = item[0]?.transcript || '';
      if (item.isFinal) {
        finalChunk += text + ' ';
      } else {
        interim += text;
      }
    }

    const spokenText = (finalChunk + interim).trim().toLowerCase();

    // 1. SE ESTÁ EM MODO DE ESPERA DE PALAVRA-CHAVE:
    if (this.state === 'listening_wake_word') {
      const parsedCommand = this.parseVoiceCommand(spokenText);

      // Comando de voz direto: "Criar pasta do aluno [Nome]"
      if (parsedCommand.type === 'create_folder') {
        soundEffectsService.playWakeWordChime();
        this.callbacks?.onVoiceCommand(parsedCommand);
        return;
      }

      // Verificação de palavra-chave ("professora", "assistente", etc.)
      const matchedWakeWord = this.wakeWords.find((w) => spokenText.includes(w));
      if (matchedWakeWord) {
        soundEffectsService.playWakeWordChime();
        this.setState('recording_dictation');

        // Extrai o conteúdo após a palavra-chave se já tiver falado junto
        const afterWakeWord = spokenText.split(matchedWakeWord)[1] || '';
        const commandAfter = this.parseVoiceCommand(afterWakeWord);

        if (commandAfter.type === 'create_folder' || commandAfter.type === 'dictate_to_student') {
          this.callbacks?.onVoiceCommand(commandAfter);
          if (commandAfter.content) {
            this.currentTranscript = commandAfter.content + ' ';
            this.callbacks?.onTranscriptChange(this.currentTranscript, false);
          }
        } else if (afterWakeWord.trim()) {
          this.currentTranscript = afterWakeWord.trim() + ' ';
          this.callbacks?.onTranscriptChange(this.currentTranscript, false);
        }

        this.resetSilenceCountdown();
        return;
      }
    }

    // 2. SE JÁ ESTÁ EM MODO DE GRAVAÇÃO DO DITADO:
    if (this.state === 'recording_dictation') {
      // Se a professora voltar a falar, zera o contador regressivo de silêncio!
      this.resetSilenceCountdown();

      // Verifica comandos rápidos de finalização ou cancelamento
      if (spokenText.includes('finalizar anotação') || spokenText.includes('salvar anotação')) {
        this.finalizeDictation();
        return;
      }
      if (spokenText.includes('cancelar anotação') || spokenText.includes('descartar')) {
        this.clearCountdown();
        this.currentTranscript = '';
        this.interimTranscript = '';
        this.callbacks?.onTranscriptChange('', false);
        this.setState('idle');
        return;
      }

      if (finalChunk) {
        this.currentTranscript += finalChunk;
      }
      this.interimTranscript = interim;

      const fullLive = (this.currentTranscript + ' ' + this.interimTranscript).trim();
      this.callbacks?.onTranscriptChange(fullLive, !!interim);
    }
  }

  // Identifica comandos especiais na fala (público para reaproveitamento nativo)
  public parseVoiceCommand(text: string): VoiceCommandDetection {
    const clean = text.toLowerCase().trim();

    // Comando 1: Criar pasta de aluno
    // Ex: "criar pasta do aluno gabriel", "nova pasta da aluna beatriz", "criar pasta pedro"
    const createFolderRegex = /(?:criar|nova|novo|adicionar)\s+pasta(?:\s+do|\s+da)?(?:\s+aluno|\s+aluna)?\s+([a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ\s]+)/i;
    const matchFolder = clean.match(createFolderRegex);
    if (matchFolder && matchFolder[1]) {
      const studentName = matchFolder[1].trim();
      return {
        type: 'create_folder',
        studentName: this.capitalizeName(studentName),
      };
    }

    // Comando 2: "Novo aluno [Nome]" ou "Adicionar aluno [Nome]"
    const newStudentRegex = /(?:novo aluno|nova aluna|adicionar aluno|cadastrar aluno)\s+([a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ\s]+)/i;
    const matchNewStudent = clean.match(newStudentRegex);
    if (matchNewStudent && matchNewStudent[1]) {
      return {
        type: 'create_folder',
        studentName: this.capitalizeName(matchNewStudent[1].trim()),
      };
    }

    // Comando 3: "Anotar para [Nome]: [Conteúdo]"
    const dictateToStudentRegex = /(?:anotar para|observação para|anote para|pasta d[eoa])\s+([a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]+)(?:\s*:\s*|\s+)(.*)/i;
    const matchDictate = clean.match(dictateToStudentRegex);
    if (matchDictate && matchDictate[1]) {
      return {
        type: 'dictate_to_student',
        studentName: this.capitalizeName(matchDictate[1].trim()),
        content: matchDictate[2] ? matchDictate[2].trim() : '',
      };
    }

    return { type: 'unknown' };
  }

  private capitalizeName(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  private handleError(event: any) {
    if (event.error === 'no-speech') {
      return;
    }
    if (event.error === 'aborted') {
      return;
    }

    if (event.error === 'not-allowed') {
      if (
        typeof window !== 'undefined' &&
        window.isSecureContext === false &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'
      ) {
        this.callbacks?.onError(
          'Atenção: Navegadores no celular exigem HTTPS para o microfone. Use "npx expo start --tunnel" para gerar o link seguro.'
        );
        return;
      }
      this.callbacks?.onError('Permissão de microfone negada no navegador. Autorize o acesso nas configurações do site.');
      return;
    }

    console.warn('Erro no reconhecimento de fala:', event.error);
    this.callbacks?.onError(`Reconhecimento de fala: ${event.error}`);
  }

  private handleEnd() {
    // No celular com continuous: false, quando o usuário pausa a fala, reinicia para continuar capturando
    if (!this.isUserInitiatedStop && (this.state === 'listening_wake_word' || this.state === 'recording_dictation')) {
      this.restartTimeout = setTimeout(() => {
        try {
          if (this.checkIsMobile()) {
            this.initRecognition();
          }
          this.recognition?.start();
        } catch {
          // ignore
        }
      }, 250);
    }
  }
}

export const speechRecognitionService = new SpeechRecognitionService();
