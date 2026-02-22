export const API_BASE = "http://127.0.0.1:8000";

export const getToken = () => {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(^| )token=([^;]+)/);
  return match ? match[2] : null;
};

export const clearToken = () => {
  document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC";
};

export const decodeToken = (token: string) => {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
};

export const isTokenExpired = (token: string | null) => {
  if (!token) return true;
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return true;
  return decoded.exp * 1000 < Date.now();
};

// Alarm sound generator using Web Audio API
export const playAlarmSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Alarm frequencies (dual tone - loud and noticeable)
    oscillator.frequency.value = 800; // Hz
    oscillator.type = "sine";

    // Volume control
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);

    oscillator.start();

    // Stop after 500ms
    setTimeout(() => {
      oscillator.stop();
    }, 500);
  } catch (error) {
    console.error("Error playing alarm:", error);
  }
};

export const startContinuousAlarm = (duration: number = 5000) => {
  const startTime = Date.now();
  const alarmInterval = setInterval(() => {
    if (Date.now() - startTime > duration) {
      clearInterval(alarmInterval);
      return;
    }
    playAlarmSound();
  }, 600); // Play every 600ms (overlapping beeps)

  return () => clearInterval(alarmInterval);
};
