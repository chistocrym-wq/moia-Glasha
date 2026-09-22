import Image from "next/image";

export function GlashaCharacter({
  src,
  alt = "Глаша",
  priority = false,
  className = "",
}: {
  src: string;
  alt?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={560}
      height={1400}
      priority={priority}
      sizes="(max-width: 760px) 190px, 320px"
      className={`glashaImage ${className}`}
    />
  );
}

export function AssistantAvatar({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/glasha/avatar.webp"
      alt="Глаша"
      width={512}
      height={512}
      sizes="48px"
      className={`assistantAvatar ${className}`}
      priority
    />
  );
}
