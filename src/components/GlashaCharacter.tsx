import Image from "next/image";

const SHEET_WIDTH = 1211;
const SHEET_HEIGHT = 1299;
const COLS = 5;
const ROWS = 2;

export function GlashaCharacter({
  sprite = 0,
  priority = false,
  className = "",
}: {
  sprite?: number;
  priority?: boolean;
  className?: string;
}) {
  const safe = Math.max(0, Math.min(sprite, COLS * ROWS - 1));
  const col = safe % COLS;
  const row = Math.floor(safe / COLS);

  return (
    <div className={`glashaCrop ${className}`} aria-label="Глаша">
      <Image
        src="/glasha/glasha-sprite.webp"
        alt=""
        aria-hidden="true"
        width={SHEET_WIDTH}
        height={SHEET_HEIGHT}
        sizes="(max-width: 760px) 145px, 175px"
        priority={priority}
        unoptimized
        className="glashaSheet"
        style={{ transform: `translate(-${col * 20}%, -${row * 50}%)` }}
      />
    </div>
  );
}

export function AssistantAvatar({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/icons/dasha-placeholder.svg"
      alt="Аватар Глаши"
      width={192}
      height={192}
      unoptimized
      className={`assistantAvatar ${className}`}
      priority
    />
  );
}
