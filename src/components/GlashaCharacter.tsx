import Image from "next/image";

export type GlashaImage =
  | "home"
  | "work"
  | "health"
  | "learning"
  | "travel"
  | "documents"
  | "quick"
  | "ideas"
  | "cat"
  | "cooking";

export function GlashaCharacter({
  image,
  priority = false,
  className = "",
  alt = "Глаша",
}: {
  image: GlashaImage;
  priority?: boolean;
  className?: string;
  alt?: string;
}) {
  return (
    <div className={`glashaCharacter ${className}`}>
      <Image
        src={`/glasha/characters/${image}.webp`}
        alt={alt}
        width={793}
        height={1983}
        sizes="(max-width: 760px) 180px, (max-width: 1100px) 250px, 330px"
        priority={priority}
        className="glashaCharacterImage"
      />
    </div>
  );
}

export function AssistantAvatar({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/glasha/avatar.webp"
      alt="Глаша"
      width={640}
      height={640}
      sizes="64px"
      className={`assistantAvatar ${className}`}
      priority
    />
  );
}
