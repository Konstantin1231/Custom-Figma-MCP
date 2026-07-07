export { getFigmaDataTool } from "./get-figma-data-tool.js";
// v1 image tools (local download + upload-to-storage) are kept on disk for
// reference but no longer registered — ms-figma now hosts images itself, so
// the server only needs to resolve and hand back public URLs.
export { downloadFigmaImagesTool } from "./download-fogma-images-tool-v2.js";
export type { DownloadImagesParams } from "./download-fogma-images-tool-v2.js";
export type { GetFigmaDataParams } from "./get-figma-data-tool.js";
