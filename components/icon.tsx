export type IconName = "document" | "upload" | "check" | "close" | "shield" | "folder" | "alert";

const paths: Record<IconName, string> = {
  document: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8M8 17h5",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  shield: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6",
  folder: "M3 7V5h6l2 2h10v13H3V7Z",
  alert: "m12 3 10 18H2L12 3Zm0 6v5m0 3h.01",
};

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
