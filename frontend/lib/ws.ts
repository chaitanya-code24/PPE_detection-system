export function createStreamWS(camId: string, token: string) {
  const ws = new WebSocket(
    `ws://127.0.0.1:8000/ws/video?cam=${camId}&token=${token}`
  );
  ws.binaryType = "arraybuffer";
  return ws;
}