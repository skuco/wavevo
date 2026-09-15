// A small, original synthesized session. It follows the same upload path as user audio.
export function createDemoFiles() {
  const sampleRate = 22050;
  const seconds = 24;
  return ["Midnight bass", "Pocket drums"].map((name, instrument) => {
    const length = sampleRate * seconds;
    const data = new ArrayBuffer(44 + length * 4);
    const view = new DataView(data);
    const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, "RIFF"); view.setUint32(4, 36 + length * 4, true); text(8, "WAVE"); text(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, length * 4, true);
    let seed = 12345;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const beat = t % 0.5;
      const hat = t % 0.25;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = seed / 0xffffffff * 2 - 1;
      const frequency = [65.406, 65.406, 77.782, 58.27][Math.floor(t / 3) % 4];
      const bass = (Math.sin(2 * Math.PI * frequency * t) + 0.22 * Math.sin(4 * Math.PI * frequency * t)) * Math.min(1, beat * 90) * Math.exp(-beat * 4) * 0.38;
      const kick = Math.sin(2 * Math.PI * (50 * beat + 9 * (1 - Math.exp(-beat * 30)))) * Math.exp(-beat * 22) * 0.65;
      const snare = Math.floor(t / 0.5) % 2 ? noise * Math.exp(-beat * 32) * 0.32 : 0;
      const value = instrument ? kick + snare + noise * Math.exp(-hat * 100) * 0.12 : bass;
      const fade = Math.min(1, t * 20, (seconds - t) * 10);
      for (let channel = 0; channel < 2; channel++) view.setInt16(44 + i * 4 + channel * 2, Math.max(-1, Math.min(1, value * fade * (channel ? 0.93 : 1))) * 32767, true);
    }
    return new File([data], `${name}.wav`, { type: "audio/wav" });
  });
}
