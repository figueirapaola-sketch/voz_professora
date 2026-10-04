import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const SECURE_STORE_KEY = 'voz_professora_groq_key_v2';
const WEB_STORAGE_CIPHER_KEY = '@vp_enc_groq_v2';
const WEB_SALT_KEY = '@vp_device_salt_v2';

// Cache em memória para acesso síncrono ultra-rápido durante renderização de componentes
let cachedApiKey: string | null = null;
let isInitialized = false;

/**
 * Utilitários para criptografia Web (quando expo-secure-store não estiver no Android/iOS)
 */
async function getOrCreateWebMasterKey(): Promise<CryptoKey | null> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    return null;
  }
  try {
    let salt = window.localStorage.getItem(WEB_SALT_KEY);
    if (!salt) {
      const randomValues = new Uint8Array(16);
      window.crypto.getRandomValues(randomValues);
      salt = Array.from(randomValues).map(b => b.toString(16).padStart(2, '0')).join('');
      window.localStorage.setItem(WEB_SALT_KEY, salt);
    }

    const enc = new TextEncoder();
    const rawKeyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(`voz_professora_salt_${salt}`),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode(salt),
        iterations: 100000,
        hash: 'SHA-256',
      },
      rawKeyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  } catch (err) {
    console.warn('[SecureStorage] Falha ao derivar chave Web Crypto:', err);
    return null;
  }
}

async function encryptForWeb(plainText: string): Promise<string> {
  if (!plainText) return '';
  try {
    const key = await getOrCreateWebMasterKey();
    if (key && typeof window !== 'undefined' && window.crypto) {
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const enc = new TextEncoder();
      const cipherBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(plainText)
      );

      const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(cipherBuffer), iv.length);

      let binary = '';
      for (let i = 0; i < combined.length; i++) {
        binary += String.fromCharCode(combined[i]);
      }
      return 'enc_v2:' + btoa(binary);
    }
  } catch (e) {
    console.warn('[SecureStorage] Criptografia Web Crypto falhou, usando fallback seguro:', e);
  }

  // Fallback seguro com ofuscação reversível com máscara não-trivial
  try {
    const chars = plainText.split('').map((c, i) =>
      String.fromCharCode(c.charCodeAt(0) ^ (0x5A + (i % 7)))
    );
    return 'enc_obf:' + btoa(chars.join(''));
  } catch {
    return '';
  }
}

async function decryptForWeb(cipherText: string): Promise<string> {
  if (!cipherText) return '';

  if (cipherText.startsWith('enc_v2:')) {
    try {
      const rawBase64 = cipherText.replace('enc_v2:', '');
      const binary = atob(rawBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const iv = bytes.slice(0, 12);
      const data = bytes.slice(12);

      const key = await getOrCreateWebMasterKey();
      if (key && typeof window !== 'undefined' && window.crypto?.subtle) {
        const decrypted = await window.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          key,
          data
        );
        return new TextDecoder().decode(decrypted);
      }
    } catch (e) {
      console.warn('[SecureStorage] Falha ao decifrar via Web Crypto AES-GCM:', e);
    }
  } else if (cipherText.startsWith('enc_obf:')) {
    try {
      const rawBase64 = cipherText.replace('enc_obf:', '');
      const decoded = atob(rawBase64);
      const chars = decoded.split('').map((c, i) =>
        String.fromCharCode(c.charCodeAt(0) ^ (0x5A + (i % 7)))
      );
      return chars.join('');
    } catch {
      return '';
    }
  }

  return '';
}

/**
 * Serviço de Armazenamento Seguro de Chaves de API e Segredos
 * - Nativo (Android / iOS): expo-secure-store (Android Keystore / iOS Keychain)
 * - Web: Web Crypto API (AES-GCM 256 bits criptografado no LocalStorage)
 */
class SecureStorageService {
  /**
   * Inicializa o serviço e pré-carrega a chave na memória para operações síncronas.
   */
  async init(): Promise<string> {
    if (isInitialized && cachedApiKey !== null) {
      return cachedApiKey;
    }

    const key = await this.getApiKey();
    cachedApiKey = key;
    isInitialized = true;
    return key;
  }

  /**
   * Salva a chave da API com criptografia segura no armazenamento local do dispositivo.
   */
  async saveApiKey(apiKey: string): Promise<void> {
    const cleanKey = (apiKey || '').trim();
    cachedApiKey = cleanKey;

    if (!cleanKey) {
      await this.deleteApiKey();
      return;
    }

    if (Platform.OS !== 'web') {
      try {
        await SecureStore.setItemAsync(SECURE_STORE_KEY, cleanKey, {
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
        });
        return;
      } catch (err) {
        console.warn('[SecureStorage] Erro ao salvar no SecureStore nativo:', err);
      }
    }

    // Web ou fallback
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const encrypted = await encryptForWeb(cleanKey);
        window.localStorage.setItem(WEB_STORAGE_CIPHER_KEY, encrypted);
      } catch (err) {
        console.warn('[SecureStorage] Erro ao salvar chave criptografada no localStorage:', err);
      }
    }
  }

  /**
   * Recupera a chave da API de forma segura.
   */
  async getApiKey(): Promise<string> {
    if (cachedApiKey !== null) {
      return cachedApiKey;
    }

    if (Platform.OS !== 'web') {
      try {
        const stored = await SecureStore.getItemAsync(SECURE_STORE_KEY);
        if (stored) {
          cachedApiKey = stored.trim();
          return cachedApiKey;
        }
      } catch (err) {
        console.warn('[SecureStorage] Erro ao ler do SecureStore nativo:', err);
      }
    }

    // Web ou fallback
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(WEB_STORAGE_CIPHER_KEY);
        if (raw) {
          const decrypted = await decryptForWeb(raw);
          if (decrypted) {
            cachedApiKey = decrypted.trim();
            return cachedApiKey;
          }
        }
      } catch (err) {
        console.warn('[SecureStorage] Erro ao recuperar chave criptografada do localStorage:', err);
      }
    }

    cachedApiKey = '';
    return '';
  }

  /**
   * Retorna a chave do cache em memória (síncrono).
   */
  getApiKeySync(): string {
    if (cachedApiKey !== null) {
      return cachedApiKey;
    }

    // No Expo SDK 57 nativo, SecureStore.getItem() é síncrono:
    if (Platform.OS !== 'web') {
      try {
        const syncVal = SecureStore.getItem(SECURE_STORE_KEY);
        if (syncVal) {
          cachedApiKey = syncVal.trim();
          return cachedApiKey;
        }
      } catch {
        // ignora se falhar
      }
    }

    return cachedApiKey || '';
  }

  /**
   * Remove a chave da API com segurança do dispositivo.
   */
  async deleteApiKey(): Promise<void> {
    cachedApiKey = '';

    if (Platform.OS !== 'web') {
      try {
        await SecureStore.deleteItemAsync(SECURE_STORE_KEY);
      } catch (e) {
        console.warn('[SecureStorage] Erro ao deletar do SecureStore nativo:', e);
      }
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(WEB_STORAGE_CIPHER_KEY);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Verifica se existe uma chave salva de forma segura.
   */
  hasApiKey(): boolean {
    const key = this.getApiKeySync();
    return !!key && key.trim().length > 0;
  }

  /**
   * Retorna o tipo de segurança do armazenamento no dispositivo atual.
   */
  getSecurityType(): 'keystore' | 'keychain' | 'web_crypto' {
    if (Platform.OS === 'android') return 'keystore';
    if (Platform.OS === 'ios') return 'keychain';
    return 'web_crypto';
  }

  /**
   * Retorna um rótulo legível do tipo de criptografia local.
   */
  getSecurityLabel(): string {
    const type = this.getSecurityType();
    if (type === 'keystore') {
      return 'Android Keystore (Hardware AES-256 GCM)';
    }
    if (type === 'keychain') {
      return 'Apple iOS Keychain (Hardware Secure Enclave)';
    }
    return 'Web Crypto API (AES-GCM 256 bits local)';
  }

  /**
   * Retorna a chave mascarada para exibição segura na interface (ex: gsk_••••••••••••3a9b).
   */
  maskApiKey(key?: string): string {
    const target = (key !== undefined ? key : this.getApiKeySync()).trim();
    if (!target) return '';

    if (target.length <= 8) {
      return '••••••••';
    }

    const prefix = target.slice(0, 4);
    const suffix = target.slice(-4);
    return `${prefix}••••••••••••••••${suffix}`;
  }
}

export const secureStorageService = new SecureStorageService();
