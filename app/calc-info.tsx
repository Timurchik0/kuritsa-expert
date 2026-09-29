"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type Calculation = {
  label: string;
  formula: string;
  substitution: string;
  source: string;
  excel: string;
};

export function CalcInfo({ label, formula, substitution, source, excel }: Calculation) {
  const [open, setOpen] = useState(false);
  return <Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger asChild>
      <button type="button" aria-label={`Как считается: ${label}`} className="inline-flex shrink-0 items-center justify-center rounded p-0.5 text-[#85968c] hover:text-[#147d6e] focus-visible:outline-2 focus-visible:outline-[#147d6e]" onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}>
        <CircleHelp size={15} />
      </button>
    </TooltipTrigger>
    <TooltipContent side="top" className="z-[90] max-w-[min(350px,calc(100vw-2rem))] space-y-2 rounded border border-[#cadbd0] bg-white px-3 py-3 text-left text-xs font-normal leading-5 text-[#30463a] shadow-lg">
      <div className="font-semibold">{label}</div>
      <div>{formula}</div>
      <div className="break-words text-[#176e5a]">Сейчас: {substitution}</div>
      <div className="text-[#64786a]">Источник: {source}</div>
      <div className="text-[#64786a]">Excel: {excel}</div>
    </TooltipContent>
  </Tooltip>;
}
