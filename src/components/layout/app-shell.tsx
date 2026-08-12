"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Archive,
  Bell,
  Bookmark,
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  ClipboardCheck,
  GanttChart,
  HardDrive,
  Headphones,
  LayoutDashboard,
  Layers3,
  LogOut,
  Menu,
  MessageCircle,
  PlusCircle,
  ReceiptText,
  Repeat2,
  ShieldCheck,
  Timer,
  Users,
} from "lucide-react";
import dynamic from "next/dynamic";
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

const HeaderSearch = dynamic(() =>
  import("@/components/layout/header-search").then(
    (module) => module.HeaderSearch,
  ),
);

const navigation = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, adminOnly: false },
  { href: "/files", label: "Files", icon: HardDrive, adminOnly: false },
  { href: "/inbox", label: "Inbox", icon: Bell, adminOnly: false },
  { href: "/chat", label: "Chat", icon: MessageCircle, adminOnly: false },
];

const workNavigation = [
  { href: "/projects", label: "Projects", icon: BriefcaseBusiness, adminOnly: false },
  { href: "/support", label: "Support", icon: Headphones, adminOnly: false },
  { href: "/my-work", label: "My assignments", icon: ClipboardCheck, adminOnly: false },
  { href: "/team", label: "Team capacity", icon: Users, adminOnly: false },
  { href: "/roadmap", label: "Portfolio", icon: GanttChart, adminOnly: false },
];

const clientNavigation = [
  { href: "/clients", label: "Companies", icon: Building2, adminOnly: false },
  { href: "/clients/prospects", label: "Prospects", icon: Activity, adminOnly: false },
];

const moreNavigation = [
  { href: "/saved", label: "Saved items", icon: Bookmark, adminOnly: false },
  { href: "/capture", label: "Quick capture", icon: PlusCircle, adminOnly: false },
  { href: "/client", label: "Shared with me", icon: Users, adminOnly: false },
  { href: "/activity", label: "Audit history", icon: Activity, adminOnly: false },
  { href: "/archive", label: "Basecamp archive", icon: Archive, adminOnly: false },
  {
    href: "/admin",
    label: "Workspace admin",
    icon: ShieldCheck,
    adminOnly: true,
  },
  {
    href: "/admin/operations",
    label: "Access & integrations",
    icon: ShieldCheck,
    adminOnly: true,
  },
];

const commercialNavigation = [
  { href: "/retainers", label: "Contracts", icon: Repeat2 },
  { href: "/time", label: "Time", icon: Timer },
  { href: "/billing", label: "Billing", icon: ReceiptText },
  { href: "/reports", label: "Reports", icon: Activity },
];

interface ShellUser {
  name: string;
  initials: string;
  title: string;
}

function Navigation({
  canCommercialRead,
  canSupportRead,
  isAdmin,
  inboxCount = 0,
  onNavigate,
}: {
  canCommercialRead: boolean;
  canSupportRead: boolean;
  isAdmin: boolean;
  inboxCount?: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const commercialActive = commercialNavigation.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const workActive = workNavigation.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const clientsActive = clientNavigation.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const moreActive = moreNavigation.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const [workOpen, setWorkOpen] = useState(workActive);
  const [clientsOpen, setClientsOpen] = useState(clientsActive);
  const [commercialOpen, setCommercialOpen] = useState(commercialActive);
  const [moreOpen, setMoreOpen] = useState(moreActive);
  const visibleWorkNavigation = workNavigation.filter(
    (item) => item.href !== "/support" || canSupportRead,
  );
  const visibleMoreNavigation = moreNavigation.filter(
    (item) => !item.adminOnly || isAdmin,
  );

  function renderNavigationItem(
    item:
      | (typeof navigation)[number]
      | (typeof workNavigation)[number]
      | (typeof clientNavigation)[number]
      | (typeof commercialNavigation)[number]
      | (typeof moreNavigation)[number],
    nested = false,
  ) {
    const active =
      pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Button
        asChild
        className={cn(
          nested ? "h-9 justify-start px-3" : "h-10 justify-start px-3",
          "text-sidebar-foreground/70",
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
          {item.href === "/inbox" && inboxCount > 0 && (
            <Badge className="ml-auto h-5 min-w-5 justify-center px-1.5 text-[10px]">
              {inboxCount > 99 ? "99+" : inboxCount}
            </Badge>
          )}
        </Link>
      </Button>
    );
  }

  function renderGroup({
    active,
    icon: Icon,
    items,
    label,
    open,
    setOpen,
  }: {
    active: boolean;
    icon: typeof BriefcaseBusiness;
    items: Array<
      | (typeof workNavigation)[number]
      | (typeof clientNavigation)[number]
      | (typeof commercialNavigation)[number]
      | (typeof moreNavigation)[number]
    >;
    label: string;
    open: boolean;
    setOpen: (value: boolean) => void;
  }) {
    return (
      <>
        <Button
          aria-expanded={open}
          className={cn(
            "h-10 justify-start px-3 text-sidebar-foreground/70",
            active && "text-sidebar-accent-foreground",
          )}
          onClick={() => setOpen(!open)}
          variant="ghost"
        >
          <Icon />
          {label}
          <ChevronDown
            className={cn(
              "ml-auto size-4 transition-transform",
              open && "rotate-180",
            )}
          />
        </Button>
        {open ? (
          <div className="ml-4 grid gap-1 border-l border-sidebar-border pl-2">
            {items.map((item) => renderNavigationItem(item, true))}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <nav aria-label="Main navigation" className="grid gap-1">
      {navigation.slice(0, 3).map((item) => renderNavigationItem(item))}
      {renderGroup({
        active: workActive,
        icon: BriefcaseBusiness,
        items: visibleWorkNavigation,
        label: "Work",
        open: workOpen,
        setOpen: setWorkOpen,
      })}
      {renderGroup({
        active: clientsActive,
        icon: Building2,
        items: clientNavigation,
        label: "Clients",
        open: clientsOpen,
        setOpen: setClientsOpen,
      })}
      {canCommercialRead
        ? renderGroup({
            active: commercialActive,
            icon: ReceiptText,
            items: commercialNavigation,
            label: "Commercial",
            open: commercialOpen,
            setOpen: setCommercialOpen,
          })
        : null}
      {navigation.slice(3).map((item) => renderNavigationItem(item))}
      {renderGroup({
        active: moreActive,
        icon: Menu,
        items: visibleMoreNavigation,
        label: "More",
        open: moreOpen,
        setOpen: setMoreOpen,
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
  canCommercialRead,
  canSupportRead,
}: {
  children: React.ReactNode;
  user: ShellUser;
  demoMode: boolean;
  isAdmin: boolean;
  canCommercialRead: boolean;
  canSupportRead: boolean;
}) {
  const pathname = usePathname();
  const chatMode = pathname.startsWith("/chat");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const loadCount = () => {
      void fetch("/api/inbox?count=1", { signal: controller.signal })
        .then(async (response) => {
          const result = (await response.json()) as {
            counts?: { open?: number };
          };
          if (response.ok) setInboxCount(result.counts?.open ?? 0);
        })
        .catch(() => undefined);
    };
    loadCount();
    window.addEventListener("inbox:changed", loadCount);
    return () => {
      controller.abort();
      window.removeEventListener("inbox:changed", loadCount);
    };
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex lg:flex-col">
        <div className="px-5 py-5">
          <Brand />
        </div>
        <Separator className="bg-sidebar-border" />
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
          <Navigation
            canCommercialRead={canCommercialRead}
            canSupportRead={canSupportRead}
            inboxCount={inboxCount}
            isAdmin={isAdmin}
          />
        </div>
        <div className="space-y-3 border-t border-sidebar-border p-4">
          <div className="rounded-xl bg-sidebar-accent/60 p-3">
            <p className="text-xs font-medium">Connected workspace</p>
            <p className="mt-1 text-[11px] leading-4 text-sidebar-foreground/50">
              Accelo read-only · Supabase operational core.
            </p>
          </div>
          <UserMenu user={user} />
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/92 px-4 backdrop-blur sm:px-6">
          <Sheet
            onOpenChange={setMobileNavigationOpen}
            open={mobileNavigationOpen}
          >
            <SheetTrigger asChild>
              <Button aria-label="Open navigation" className="lg:hidden" size="icon" variant="outline">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              className="overflow-y-auto bg-sidebar text-sidebar-foreground"
              side="left"
            >
              <SheetHeader className="text-left">
                <SheetTitle className="text-sidebar-foreground"><Brand /></SheetTitle>
                <SheetDescription className="sr-only">Workspace navigation</SheetDescription>
              </SheetHeader>
              <div className="px-3">
                <Navigation
                  canCommercialRead={canCommercialRead}
                  canSupportRead={canSupportRead}
                  inboxCount={inboxCount}
                  isAdmin={isAdmin}
                  onNavigate={() => setMobileNavigationOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>

          {!chatMode && <HeaderSearch />}
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
