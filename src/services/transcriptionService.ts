import { Platform } from 'react-native';
import { databaseService } from './databaseService';

export interface TranscriptionResult {
  text: string;
  success: boolean;
  error?: string;
  durationSeconds?: number;
}

class TranscriptionService {
  /**
   * Transcreve um arquivo de áudio gravado nativamente ou via Web para texto em português.
   */
  async transcribeAudio(
    audioUri: string,
    durationSeconds?: number
  ): Promise<TranscriptionResult> {
    if (!audioUri) {
      return { text: '', success: false, error: 'Caminho de áudio inválido.' };
    }

    const settings = databaseService.getSettings();
    let apiKey = (await databaseService.getSecureTranscriptionKey()) || (settings.transcriptionApiKey || '').trim();
    let provider = settings.transcriptionProvider || 'groq';

    // Fallback para variáveis de ambiente públicas caso configuradas
    if (!apiKey) {
      if (typeof process !== 'undefined' && process.env) {
        if (process.env.EXPO_PUBLIC_GROQ_API_KEY) {
          apiKey = process.env.EXPO_PUBLIC_GROQ_API_KEY.trim();
          provider = 'groq';
        } else if (process.env.EXPO_PUBLIC_OPENAI_API_KEY) {
          apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY.trim();
          provider = 'openai';
        }
      }
    }

    // Se nenhuma chave estiver configurada, avisa que é necessária a chave do Groq ou OpenAI
    if (!apiKey && provider !== 'custom') {
      console.warn('[TranscriptionService] Nenhuma chave de API configurada.');
      return {
        text: '',
        success: false,
        error: 'NO_KEY',
      };
    }

    try {
      console.log(`[TranscriptionService] Iniciando transcrição com ${provider}. URI: ${audioUri.slice(0, 50)}...`);

      // 1. Pausa estratégica de 400ms para permitir que o sistema de arquivos do Android/iOS termine de fechar o buffer do áudio
      await new Promise((resolve) => setTimeout(resolve, 400));

      let endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
      let model = 'whisper-large-v3-turbo';

      if (apiKey.startsWith('gsk_') || provider === 'groq') {
        endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
        model = 'whisper-large-v3-turbo';
      } else if (apiKey.startsWith('sk-') || provider === 'openai') {
        endpoint = 'https://api.openai.com/v1/audio/transcriptions';
        model = 'whisper-1';
      } else if (provider === 'custom' && settings.customTranscriptionUrl) {
        endpoint = settings.customTranscriptionUrl.trim();
        model = 'whisper-1';
      }

      let cleanUri = audioUri;
      if (
        Platform.OS !== 'web' &&
        !cleanUri.startsWith('file://') &&
        !cleanUri.startsWith('content://') &&
        !cleanUri.startsWith('blob:') &&
        !cleanUri.startsWith('http://') &&
        !cleanUri.startsWith('https://')
      ) {
        cleanUri = 'file://' + cleanUri;
      }

      const isWebm =
        cleanUri.toLowerCase().includes('.webm') ||
        cleanUri.startsWith('blob:') ||
        (Platform.OS === 'web' && audioUri.startsWith('blob:'));
      const fileName = isWebm ? 'audio.webm' : 'recording.m4a';
      const mimeType = isWebm ? 'audio/webm' : 'audio/m4a';

      // No Expo SDK 54+ e SDK 57+ com expo/fetch (WinterCG compliant),
      // o FormData só aceita strings e Blobs válidos. O formato legado
      // do React Native { uri, name, type } lança "Unsupported FormDataPart implementation".
      // Carregamos a URI como Blob (compatível com Web, Android e iOS).
      const fileResponse = await fetch(cleanUri);
      if (!fileResponse.ok) {
        throw new Error(`Falha ao ler o áudio local (${fileResponse.status}): ${fileResponse.statusText}`);
      }
      const rawBlob = await fileResponse.blob();

      // Garante tipo de áudio correto para APIs Whisper (Groq / OpenAI)
      const fileBlob =
        rawBlob.type && rawBlob.type.startsWith('audio/')
          ? rawBlob
          : new Blob([rawBlob], { type: mimeType });

      const formData = new FormData();
      formData.append('file', fileBlob, fileName);

      formData.append('model', model);
      formData.append('language', 'pt');
      formData.append('response_format', 'json');

      const headers: Record<string, string> = {};
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout

      console.log(`[TranscriptionService] Enviando requisição para ${endpoint}...`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        let errorDetail = '';
        try {
          const errData = await res.json();
          errorDetail = errData?.error?.message || JSON.stringify(errData);
        } catch {
          errorDetail = res.statusText || `Código ${res.status}`;
        }
        console.warn(`[TranscriptionService] Erro na API (${res.status}):`, errorDetail);

        let userMessage = `Falha na transcrição (${res.status}): ${errorDetail}`;
        if (res.status === 401) {
          userMessage = 'Chave da API do Groq inválida ou expirada. Verifique sua chave no botão Transcrição.';
        } else if (res.status === 429) {
          userMessage = 'Limite de requisições da API Groq atingido. Aguarde alguns instantes.';
        } else if (res.status === 400) {
          userMessage = `Arquivo de áudio não aceito pela API (${errorDetail}).`;
        }

        return {
          text: '',
          success: false,
          error: userMessage,
        };
      }

      const data = await res.json();
      const transcribedText = (data?.text || '').trim();

      console.log(`[TranscriptionService] Sucesso! Texto transcrito: "${transcribedText.slice(0, 60)}..."`);

      return {
        text: transcribedText,
        success: true,
        durationSeconds,
      };
    } catch (err: any) {
      console.warn('[TranscriptionService] Exceção durante transcrição:', err);
      if (err.name === 'AbortError') {
        return { text: '', success: false, error: 'Tempo limite excedido na transcrição do áudio.' };
      }
      return {
        text: '',
        success: false,
        error: err?.message || 'Erro de rede ao conectar à API de transcrição.',
      };
    }
  }

  /**
   * Testa a validade de uma chave de API do Groq ou OpenAI.
   */
  async testConnection(
    apiKey: string,
    provider: 'groq' | 'openai' = 'groq'
  ): Promise<{ success: boolean; message: string }> {
    const key = apiKey.trim();
    if (!key) {
      return { success: false, message: 'Por favor, insira uma chave de API.' };
    }

    try {
      const url =
        provider === 'groq' || key.startsWith('gsk_')
          ? 'https://api.groq.com/openai/v1/models'
          : 'https://api.openai.com/v1/models';

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        return {
          success: true,
          message: `Conexão estabelecida com sucesso com a API ${provider === 'groq' || key.startsWith('gsk_') ? 'Groq' : 'OpenAI'}!`,
        };
      } else {
        return {
          success: false,
          message: `Chave inválida ou não autorizada (${res.status}). Verifique a chave inserida.`,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Não foi possível conectar ao servidor de API.',
      };
    }
  }
}

export const transcriptionService = new TranscriptionService();
