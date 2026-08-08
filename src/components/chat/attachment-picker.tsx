"use client";

import { File, Paperclip, X } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENT_SIZE,
} from "@/lib/chat/attachments";

function fileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentPicker({
  disabled,
  files,
  onChange,
  onError,
}: {
  disabled?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function selectFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const incoming = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!incoming.length) return;
    if (files.length + incoming.length > MAX_CHAT_ATTACHMENTS) {
      onError(`Attach up to ${MAX_CHAT_ATTACHMENTS} files per message.`);
      return;
    }
    const invalid = incoming.find(
      (file) => !file.size || file.size > MAX_CHAT_ATTACHMENT_SIZE,
    );
    if (invalid) {
      onError(
        invalid.size
          ? `${invalid.name} is larger than 25 MB.`
          : `${invalid.name} is empty.`,
      );
      return;
    }
    onError("");
    onChange([...files, ...incoming]);
  }

  return (
    <>
      {!!files.length && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((file, index) => (
            <div
              className="flex max-w-full items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs"
              key={`${file.name}-${file.lastModified}-${index}`}
            >
              <File className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="max-w-52 truncate">{file.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {fileSize(file.size)}
              </span>
              <Button
                aria-label={`Remove ${file.name}`}
                className="size-5"
                disabled={disabled}
                onClick={() =>
                  onChange(files.filter((_, fileIndex) => fileIndex !== index))
                }
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <input
        className="hidden"
        disabled={disabled}
        multiple
        onChange={selectFiles}
        ref={inputRef}
        type="file"
      />
      <Button
        aria-label="Attach files"
        disabled={disabled || files.length >= MAX_CHAT_ATTACHMENTS}
        onClick={() => inputRef.current?.click()}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Paperclip />
      </Button>
    </>
  );
}
