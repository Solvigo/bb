import { isAbsoluteLocalPath } from "./attachment-path";
import {
  buildProjectAttachmentContentUrl,
  buildThreadHostFileContentUrl,
} from "./file-content-urls";

/**
 * `threadId` is only known once the attachment belongs to a rendered thread
 * timeline row; the promptbox draft preview (attaching, not yet sent) has no
 * thread yet and omits it, falling back to a `file://` URI for its Electron
 * host preview.
 */
export function toUserAttachmentImageSrc(
  pathOrUrl: string,
  projectId?: string,
  threadId?: string,
): string {
  if (/^(https?:|data:|blob:)/i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  if (threadId && isAbsoluteLocalPath({ path: pathOrUrl })) {
    return buildThreadHostFileContentUrl(threadId, pathOrUrl);
  }
  if (projectId) {
    return buildProjectAttachmentContentUrl(projectId, pathOrUrl);
  }

  if (/^file:/i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const normalized = pathOrUrl.replaceAll("\\", "/");
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${encodeURI(normalized)}`;
  }
  return pathOrUrl;
}
