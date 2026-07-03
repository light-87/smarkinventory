/**
 * lib/scan — HID buffer, code resolution, camera scan, offline queue
 * (docs/OWNERSHIP.md: owned by `scan`).
 */

export { startCameraScan, isBarcodeDetectorSupported, type CameraBackend, type CameraController } from "./camera";
export {
  createInitialHidBufferState,
  pushHidKey,
  checkHidAutoFlush,
  DEFAULT_HID_BUFFER_OPTIONS,
  type HidBufferState,
  type HidBufferOptions,
  type HidBufferStep,
} from "./hid-buffer";
export {
  createMemoryStorage,
  enqueueOfflineMovement,
  listOfflineMovements,
  removeOfflineMovement,
  clearOfflineMovements,
  syncOfflineMovements,
  isNetworkError,
  type OfflineQueueStorage,
  type QueuedMovement,
  type SyncOfflineMovementsResult,
} from "./offline-queue";
export {
  classifyScanCode,
  normalizeScanCode,
  resolveScanCode,
  type ScanResolution,
  type ResolvedPart,
  type ResolvedBox,
  type StockLocationWithBox,
  type BoxContentLine,
  type ScanCodeShape,
} from "./resolve";
