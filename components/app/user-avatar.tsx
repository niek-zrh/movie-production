import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function UserAvatar({
  name,
  image,
  className,
}: {
  name: string;
  image?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-6 text-[10px]", className)}>
      {image ? <AvatarImage src={image} alt={name} /> : null}
      <AvatarFallback className="font-medium">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
