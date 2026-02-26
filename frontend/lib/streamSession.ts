export type UploadSession = {
  videoUrl: string;
  autoStart: boolean;
};

export type LiveSession = {
  stream: MediaStream;
  autoStart: boolean;
};

const uploadSessions = new Map<string, UploadSession>();
const liveSessions = new Map<string, LiveSession>();

export function getUploadSession(camId: string): UploadSession | undefined {
  return uploadSessions.get(camId);
}

export function setUploadSession(camId: string, session: UploadSession): void {
  uploadSessions.set(camId, session);
}

export function clearUploadSession(camId: string): void {
  const existing = uploadSessions.get(camId);
  if (existing) {
    try {
      URL.revokeObjectURL(existing.videoUrl);
    } catch {
      // ignore revoke failures
    }
  }
  uploadSessions.delete(camId);
}

export function setUploadAutoStart(camId: string, autoStart: boolean): void {
  const current = uploadSessions.get(camId);
  if (!current) return;
  uploadSessions.set(camId, { ...current, autoStart });
}

export function getLiveSession(camId: string): LiveSession | undefined {
  return liveSessions.get(camId);
}

export function setLiveSession(camId: string, session: LiveSession): void {
  liveSessions.set(camId, session);
}

export function clearLiveSession(camId: string): void {
  const existing = liveSessions.get(camId);
  if (existing) {
    for (const track of existing.stream.getTracks()) {
      track.stop();
    }
  }
  liveSessions.delete(camId);
}

export function setLiveAutoStart(camId: string, autoStart: boolean): void {
  const current = liveSessions.get(camId);
  if (!current) return;
  liveSessions.set(camId, { ...current, autoStart });
}
