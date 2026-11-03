/**
 * PRODX POS - Sound Effects Utility Service
 * Synthesizes premium tactile audio feedback using Web Audio API.
 * This guarantees zero external assets need to be fetched, making it robust offline.
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { triggerHaptic } from '../services/hapticService';

interface SoundContextType {
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  playClick: () => void;
  playSuccess: () => void;
  playWarning: () => void;
  playCriticalAlert: () => void;
}

const SoundContext = createContext<SoundContextType | undefined>(undefined);

export const SoundProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => {
    const saved = localStorage.getItem('prodx_pos_sound_enabled');
    return saved !== null ? saved === 'true' : true;
  });

  const setSoundEnabled = (enabled: boolean) => {
    setSoundEnabledState(enabled);
    localStorage.setItem('prodx_pos_sound_enabled', String(enabled));
  };

  // Helper to get or create AudioContext safely (due to browser autoplay policies)
  const getAudioContext = (): AudioContext | null => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return null;
      return new AudioContextClass();
    } catch (e) {
      console.warn('[SoundService] Web Audio API is not supported/allowed:', e);
      return null;
    }
  };

  // Synthesize tactile crisp pop/click sound
  const playClick = () => {
    triggerHaptic('tap');
    if (!soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Crisp tick frequency
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.04);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.05);
  };

  // Synthesize high ascending professional double-tone success chime
  const playSuccess = () => {
    triggerHaptic('success');
    if (!soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const playTone = (freq: number, startOffset: number, duration: number, volume: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
      
      gain.gain.setValueAtTime(0, ctx.currentTime + startOffset);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + startOffset);
      osc.stop(ctx.currentTime + startOffset + duration + 0.05);
    };

    // Beautiful harmonic chime
    playTone(523.25, 0, 0.15, 0.15); // C5
    playTone(659.25, 0.08, 0.25, 0.15); // E5
    playTone(783.99, 0.16, 0.35, 0.12); // G5
  };

  // Synthesize warn tone (low warm warning)
  const playWarning = () => {
    triggerHaptic('warning');
    if (!soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const playTone = (freq: number, startOffset: number, duration: number, volume: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
      osc.frequency.linearRampToValueAtTime(freq - 50, ctx.currentTime + startOffset + duration);

      gain.gain.setValueAtTime(0, ctx.currentTime + startOffset);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + startOffset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + startOffset);
      osc.stop(ctx.currentTime + startOffset + duration + 0.05);
    };

    // Warning alert double buzz
    playTone(220, 0, 0.15, 0.12); // A3
    playTone(220, 0.20, 0.15, 0.12); // A3
  };

  // Synthesize urgent multi-pulse hardware error / system alert siren chime
  const playCriticalAlert = () => {
    triggerHaptic('error');
    if (!soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const playAlertPulse = (
      freqStart: number,
      freqEnd: number,
      startOffset: number,
      duration: number,
      volume: number,
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freqStart, ctx.currentTime + startOffset);
      osc.frequency.linearRampToValueAtTime(freqEnd, ctx.currentTime + startOffset + duration);

      gain.gain.setValueAtTime(0.001, ctx.currentTime + startOffset);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + startOffset);
      osc.stop(ctx.currentTime + startOffset + duration + 0.03);
    };

    // Urgent 3-pulse hardware error alarm pattern (A5 -> E5 -> A5)
    playAlertPulse(880, 659.25, 0, 0.16, 0.18);
    playAlertPulse(880, 659.25, 0.2, 0.16, 0.18);
    playAlertPulse(987.77, 587.33, 0.4, 0.26, 0.22);
  };

  return (
    <SoundContext.Provider
      value={{
        soundEnabled,
        setSoundEnabled,
        playClick,
        playSuccess,
        playWarning,
        playCriticalAlert,
      }}
    >
      {children}
    </SoundContext.Provider>
  );
};

export const useSound = () => {
  const ctx = useContext(SoundContext);
  if (!ctx) {
    throw new Error('useSound must be used within a SoundProvider');
  }
  return ctx;
};
