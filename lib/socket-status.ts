const SOCKET_STATUS_URL = "https://status.socket.dev/";

function mentionsSocket(text: string): boolean {
  return /socket(?:\.dev|security)?/i.test(text);
}

function mentionsServiceUnavailable(text: string): boolean {
  return /\b503\b|service unavailable|temporar(?:y|ily) unavailable|bad gateway|gateway timeout/i.test(text);
}

export function socketStatusHintForLog(log: string): string {
  if (!mentionsSocket(log) || !mentionsServiceUnavailable(log)) return "";
  return `\n\nSocket.dev's package scanner appears to be temporarily unavailable. Check Socket.dev status: ${SOCKET_STATUS_URL}\n\nPrimordia prioritizes your server's safety, so the best course of action is try again or wait until the security scanner is available again.`;
}

export function withSocketStatusHint(message: string, log = message): string {
  return `${message}${socketStatusHintForLog(log)}`;
}
