/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL WebSocket do relay, ex.: wss://free-tabletop-relay.<conta>.workers.dev */
  readonly VITE_RELAY_URL?: string;
}

// File System Access API (Chrome/Edge). Ainda não está nos tipos padrão do TypeScript.
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}
interface FileSystemHandle {
  queryPermission(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}
interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
}
interface Window {
  showDirectoryPicker?: (opts?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}
