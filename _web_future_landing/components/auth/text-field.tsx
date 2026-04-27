"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  id: string;
  label: string;
  type?: "text" | "email" | "password" | "tel";
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
  icon?: React.ComponentType<{ className?: string }>;
  rightSlot?: React.ReactNode;
  inputMode?: "text" | "email" | "numeric";
  maxLength?: number;
  inputClassName?: string;
};

export function TextField({
  id, label, type = "text", value, onChange, placeholder,
  required, minLength, autoComplete, icon: Icon, rightSlot,
  inputMode, maxLength, inputClassName,
}: Props) {
  const [show, setShow] = useState(false);
  const isPw = type === "password";
  const effectiveType = isPw && show ? "text" : type;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <Label htmlFor={id} className="text-xs font-medium">{label}</Label>
        {rightSlot}
      </div>
      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        )}
        <Input
          id={id}
          type={effectiveType}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          inputMode={inputMode}
          maxLength={maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`!h-11 ${Icon ? "pl-10" : ""} ${isPw ? "pr-10" : ""} ${inputClassName || ""}`}
        />
        {isPw && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
