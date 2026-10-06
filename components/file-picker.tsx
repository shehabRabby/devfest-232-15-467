import { Icon } from "./icon";

interface FilePickerProps {
  id: string;
  accept: string;
  label: string;
  disabled: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  secondary?: boolean;
}

export function FilePicker({ id, accept, label, disabled, multiple = false, onFiles, secondary = false }: FilePickerProps) {
  return (
    <label htmlFor={id} className={`file-picker ${secondary ? "file-picker-secondary" : ""} ${disabled ? "pointer-events-none opacity-50" : ""}`}>
      <Icon name="upload" className="h-4 w-4" />
      {label}
      <input id={id} type="file" accept={accept} multiple={multiple} disabled={disabled} className="sr-only" onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        if (files.length > 0) onFiles(files);
      }} />
    </label>
  );
}
