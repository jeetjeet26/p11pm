"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const RECORD_TYPES = [
  "todo",
  "todo_list",
  "message",
  "comment",
  "campfire_line",
  "document",
  "upload",
  "schedule_entry",
  "card",
  "forwarded_email",
];

export function ArchiveFilters({
  query = "",
  recordType = "all",
  dateFrom = "",
  dateTo = "",
}: {
  query?: string;
  recordType?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const [selectedType, setSelectedType] = useState(recordType || "all");
  return (
    <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_13rem_10rem_10rem_auto]">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search Basecamp history"
          className="pl-9"
          defaultValue={query}
          maxLength={500}
          name="q"
          placeholder="Search historical work…"
        />
      </div>
      <Select onValueChange={setSelectedType} value={selectedType}>
        <SelectTrigger aria-label="Record type">
          <SelectValue placeholder="All record types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All record types</SelectItem>
          {RECORD_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {type.replaceAll("_", " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input name="type" type="hidden" value={selectedType} />
      <Input
        aria-label="History from date"
        defaultValue={dateFrom}
        name="from"
        type="date"
      />
      <Input
        aria-label="History through date"
        defaultValue={dateTo}
        name="to"
        type="date"
      />
      <Button type="submit">Filter</Button>
    </form>
  );
}
