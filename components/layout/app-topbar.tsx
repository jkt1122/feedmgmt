"use client";

import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { trpc } from "@/lib/trpc/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function AppTopbar({ user }: { user: User }) {
  const router = useRouter();
  const signOut = trpc.auth.signOut.useMutation({
    onSuccess: () => router.push("/login"),
  });

  const initials = user.email?.slice(0, 2).toUpperCase() ?? "??";

  return (
    <header className="h-14 flex items-center justify-between px-4 border-b border-border bg-card flex-shrink-0">
      <div />
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted transition-colors outline-none">
          <Avatar className="w-7 h-7">
            <AvatarFallback className="bg-accent text-primary text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm text-foreground font-medium hidden sm:block">
            {user.email}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            {user.email}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => signOut.mutate()}
            className="text-sm cursor-pointer"
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
