export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const CHUNK_BYTES = 192 * 1024;
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const types = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};
export const documentPath = file => file.webkitRelativePath || file.name;
export const documentType = file => types[file.name.split(".").pop().toLowerCase()];

export function listDocuments(files, includeSubfolders = false) {
  const accepted = [], skipped = [];
  for (const file of files) {
    const path = documentPath(file);
    let reason = "";
    if (!includeSubfolders && file.webkitRelativePath?.split("/").length > 2) reason = "子文件夹未勾选";
    else if (file.name.startsWith("~$") || file.name.startsWith(".")) reason = "临时或隐藏文件";
    else if (!documentType(file)) reason = "不支持的文件格式";
    else if (!file.size) reason = "空文件";
    else if (file.size > MAX_DOCUMENT_BYTES) reason = "超过 10 MB";
    if (reason) skipped.push({ path, reason }); else accepted.push(file);
  }
  const compare = (a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
  accepted.sort((a, b) => compare(documentPath(a), documentPath(b)));
  skipped.sort((a, b) => compare(a.path, b.path));
  return { accepted, skipped };
}

export function bytesToBase64(bytes) {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
