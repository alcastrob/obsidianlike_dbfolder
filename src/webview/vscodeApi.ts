import { HostToWebviewMessage, WebviewToHostMessage } from "../core/types";

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

export function post(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}

export function onMessage(handler: (msg: HostToWebviewMessage) => void): () => void {
  const listener = (event: MessageEvent<HostToWebviewMessage>) => handler(event.data);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
