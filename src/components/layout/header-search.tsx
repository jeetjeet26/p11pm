"use client";

import { Search } from "lucide-react";

import { WorkspaceSearch } from "@/components/layout/workspace-search";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function HeaderSearch() {
  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
          <Button
            aria-label="Search workspace"
            className="sm:hidden"
            size="icon"
            variant="outline"
          >
            <Search />
          </Button>
        </SheetTrigger>
        <SheetContent
          className="inset-x-0 top-0 h-auto w-full border-b p-4"
          side="top"
        >
          <SheetHeader className="pr-10 text-left">
            <SheetTitle>Search workspace</SheetTitle>
            <SheetDescription>
              Find projects, issues, comments, files, and history.
            </SheetDescription>
          </SheetHeader>
          <WorkspaceSearch />
        </SheetContent>
      </Sheet>

      <div className="hidden max-w-xl flex-1 sm:block">
        <WorkspaceSearch />
      </div>
    </>
  );
}
