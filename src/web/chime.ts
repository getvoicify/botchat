export type ChimeInput = {
  author: string;
  me: string;
  focused: boolean;
  muted: boolean;
  now: number;
  lastPlayedAt: number;
};

export const CHIME_GAP_MS = 2_000;

export function shouldChime(input: ChimeInput): boolean {
  if (input.muted) return false;
  if (input.focused) return false;
  if (input.author === input.me) return false;
  return input.now - input.lastPlayedAt >= CHIME_GAP_MS;
}

const TONES_HZ = [880, 1174.7];
const TONE_SPACING_S = 0.09;
const PEAK_GAIN = 0.12;
// An exponential ramp can neither start from nor reach exactly zero, and a bare
// gain.value = PEAK_GAIN clicks audibly at both ends of every tone.
const SILENT_GAIN = 0.0001;

export function createChime() {
  let context: AudioContext | null = null;

  return {
    play() {
      context ??= new AudioContext();
      if (context.state === "suspended") void context.resume();
      const at = context.currentTime;
      for (const [index, frequency] of TONES_HZ.entries()) {
        const start = at + index * TONE_SPACING_S;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(SILENT_GAIN, start);
        gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(SILENT_GAIN, start + 0.16);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.18);
      }
    },
  };
}

export type Chime = ReturnType<typeof createChime>;
