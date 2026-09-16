import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AudioMetrics, audioProfileService } from '../services/audioProfileService';
import { databaseService } from '../services/databaseService';
import { VoiceProfile } from '../types';

interface AudioVisualizerProps {
  isActive: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive }) => {
  const [metrics, setMetrics] = useState<AudioMetrics>({
    volumeDb: -60,
    volumeNormalized: 0,
    pitchHz: 0,
    isSpeechDetected: false,
    matchesTeacherProfile: false,
    matchScore: 0,
  });
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null);

  useEffect(() => {
    setVoiceProfile(databaseService.getVoiceProfile());

    if (isActive) {
      audioProfileService.startAudioStream((newMetrics) => {
        setMetrics(newMetrics);
      });
    } else {
      audioProfileService.stopAudioStream();
      setMetrics({
        volumeDb: -60,
        volumeNormalized: 0,
        pitchHz: 0,
        isSpeechDetected: false,
        matchesTeacherProfile: false,
        matchScore: 0,
      });
    }

    return () => {
      audioProfileService.stopAudioStream();
    };
  }, [isActive]);

  // Generate 12 animated wave bars based on current volume and pitch
  const bars = Array.from({ length: 14 }).map((_, idx) => {
    if (!isActive) return 4;
    const center = 7;
    const dist = Math.abs(idx - center);
    const factor = Math.max(0.2, 1 - dist * 0.12);
    const height = Math.max(4, Math.round(metrics.volumeNormalized * 42 * factor + (idx % 2 === 0 ? 3 : 0)));
    return Math.min(48, height);
  });

  return (
    <View style={styles.container}>
      {/* Visual Waveform */}
      <View style={styles.waveformRow}>
        {bars.map((barHeight, idx) => (
          <View
            key={idx}
            style={[
              styles.waveBar,
              {
                height: barHeight,
                backgroundColor:
                  !isActive
                    ? '#cbd5e1'
                    : metrics.matchesTeacherProfile
                    ? '#16a34a' // Verde vivo quando combina com a voz da professora
                    : '#eab308', // Amarelo se for ruído de fundo ou voz indeterminada
              },
            ]}
          />
        ))}
      </View>

      {/* Acoustic Metrics Badges */}
      {isActive && (
        <View style={styles.metricsRow}>
          <View style={styles.metricBadge}>
            <Ionicons name="volume-medium-outline" size={13} color="#475569" />
            <Text style={styles.metricText}>{metrics.volumeDb} dB</Text>
          </View>

          {metrics.pitchHz > 0 && (
            <View style={styles.metricBadge}>
              <Ionicons name="musical-notes-outline" size={13} color="#475569" />
              <Text style={styles.metricText}>{metrics.pitchHz} Hz</Text>
            </View>
          )}

          {voiceProfile?.calibrated && (
            <View
              style={[
                styles.matchBadge,
                {
                  backgroundColor: metrics.matchesTeacherProfile
                    ? 'rgba(22, 163, 74, 0.12)'
                    : 'rgba(234, 179, 8, 0.12)',
                  borderColor: metrics.matchesTeacherProfile ? '#86efac' : '#fde047',
                },
              ]}
            >
              <Ionicons
                name={metrics.matchesTeacherProfile ? 'checkmark-circle' : 'shield-outline'}
                size={13}
                color={metrics.matchesTeacherProfile ? '#16a34a' : '#ca8a04'}
              />
              <Text
                style={[
                  styles.matchText,
                  { color: metrics.matchesTeacherProfile ? '#15803d' : '#a16207' },
                ]}
              >
                {metrics.matchesTeacherProfile ? 'Voz Reconhecida' : 'Filtro de Ruído Ativo'}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: 10,
    width: '100%',
  },
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 50,
    paddingHorizontal: 12,
  },
  waveBar: {
    width: 4,
    borderRadius: 2,
    minHeight: 4,
    transitionDuration: '100ms' as any,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  metricBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  metricText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  matchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
  },
  matchText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
