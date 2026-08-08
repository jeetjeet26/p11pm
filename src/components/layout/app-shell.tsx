"use client";

import {
  Activity,
  BriefcaseBusiness,
  ChevronDown,
  ClipboardCheck,
  LayoutDashboard,
  Layers3,
  LogOut,
  Menu,
  MessageCircle,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, adminOnly: false },
  { href: "/projects", label: "Projects", icon: BriefcaseBusiness, adminOnly: false },
  { href: "/chat", label: "Chat", icon: MessageCircle, adminOnly: false },
  { href: "/team", label: "Team view", icon: Users, adminOnly: false },
  { href: "/my-work", label: "My assignments", icon: ClipboardCheck, adminOnly: false },
  { href: "/activity", label: "Latest activity", icon: Activity, adminOnly: false },
  {
    href: "/admin",
    label: "Workspace admin",
    icon: ShieldCheck,
    adminOnly: true,
  },
];

interface ShellUser {
  name: string;
  initials: string;
  title: string;
}

function Navigation({
  isAdmin,
  onNavigate,
}: {
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="grid gap-1">
      {navigation
        .filter((item) => !item.adminOnly || isAdmin)
        .map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(item.href));
        return (
          <Button
            asChild
            className={cn(
              "h-10 justify-start px-3 text-sidebar-foreground/70",
              active &&
                "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent",
            )}
            key={item.href}
            onClick={onNavigate}
            variant="ghost"
          >
            <Link href={item.href}>
              <item.icon />
              {item.label}
            </Link>
          </Button>
        );
        })}
    </nav>
  );
}

function Brand() {
  return (
    <Link className="flex items-center gap-3" href="/dashboard">
      <div className="grid size-9 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
        <Layers3 className="size-5" />
      </div>
      <div>
        <p className="font-semibold leading-none tracking-tight">P11 PM</p>
        <p className="mt-1 text-[11px] text-sidebar-foreground/45">
          Creative operations
        </p>
      </div>
    </Link>
  );
}

export function AppShell({
  children,
  user,
  demoMode,
  isAdmin,
}: {
  children: React.ReactNode;
  user: ShellUser;
  demoMode: boolean;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const chatMode = pathname.startsWith("/chat");

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex lg:flex-col">
        <div className="px-5 py-5">
          <Brand />
        </div>
        <Separator className="bg-sidebar-border" />
        <div className="flex-1 px-3 py-5">
          <Navigation isAdmin={isAdmin} />
        </div>
        <div className="space-y-3 border-t border-sidebar-border p-4">
          <div className="rounded-xl bg-sidebar-accent/60 p-3">
            <p className="text-xs font-medium">Connected workspace</p>
            <p className="mt-1 text-[11px] leading-4 text-sidebar-foreground/50">
              Slack and Claude Cowork-ready.
            </p>
          </div>
          <UserMenu user={user} />
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/92 px-4 backdrop-blur sm:px-6">
          <Sheet>
            <SheetTrigger asChild>
              <Button aria-label="Open navigation" className="lg:hidden" size="icon" variant="outline">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent className="bg-sidebar text-sidebar-foreground" side="left">
              <SheetHeader className="text-left">
                <SheetTitle className="text-sidebar-foreground"><Brand /></SheetTitle>
                <SheetDescription className="sr-only">Workspace navigation</SheetDescription>
              </SheetHeader>
              <div className="px-3">
                <Navigation isAdmin={isAdmin} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="relative hidden max-w-md flex-1 sm:block">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search workspace"
              className="border-transparent bg-muted/70 pl-9 shadow-none focus-visible:bg-background"
              placeholder="Search projects, people, or work…"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {demoMode && <Badge variant="secondary">Demo data</Badge>}
            <div className="lg:hidden">
              <UserMenu user={user} compact />
            </div>
          </div>
        </header>
        <main
          className={cn(
            "mx-auto w-full",
            chatMode
              ? "h-[calc(100dvh-4rem)] max-w-none overflow-hidden"
              : "max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function UserMenu({ user, compact = false }: { user: ShellUser; compact?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn(
            "h-auto w-full justify-start gap-3 px-2 py-2",
            compact
              ? "w-auto text-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
          variant="ghost"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-sidebar-primary text-xs text-sidebar-primary-foreground">
              {user.initials}
            </AvatarFallback>
          </Avatar>
          {!compact && (
            <>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium">{user.name}</span>
                <span className="block truncate text-[11px] opacity-50">{user.title}</span>
              </span>
              <ChevronDown className="size-3.5 opacity-50" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block">{user.name}</span>
          <span className="font-normal text-muted-foreground">{user.title}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <form action="/api/auth/logout" className="w-full" method="post">
            <button className="flex w-full items-center gap-2" type="submit">
              <LogOut />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
