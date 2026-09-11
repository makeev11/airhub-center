import { Check, ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/shared/lib/cn";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

type Props = {
  value: string;
  locale: string;
  label: string;
  onChange: (currency: string) => void;
};

export function BookingCurrencySelect({
  value,
  locale,
  label,
  onChange,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const russian = locale.startsWith("ru");
  const options = React.useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "currency" });
    const codes = new Set([...Intl.supportedValuesOf("currency"), value]);
    return [...codes]
      .filter(Boolean)
      .map((code) => {
        const name = names.of(code) ?? code;
        return {
          code,
          name: name.charAt(0).toLocaleUpperCase(locale) + name.slice(1),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [locale, value]);
  const filtered = options.filter(({ code, name }) =>
    `${code} ${name}`
      .toLocaleLowerCase(locale)
      .includes(query.trim().toLocaleLowerCase(locale)),
  );
  function select(code: string) {
    onChange(code);
    setOpen(false);
  }
  React.useEffect(() => {
    if (open)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);
  const selected = options.find((option) => option.code === value);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
        setActive(0);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          data-testid="airhop-settings-currency"
          className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="truncate">
            {selected ? `${selected.name} · ${value}` : value}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-1"
      >
        <Input
          role="combobox"
          aria-label={russian ? "Поиск валюты" : "Search currencies"}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            filtered[active] ? `${listId}-${active}` : undefined
          }
          placeholder={
            russian ? "Название или код валюты" : "Currency name or code"
          }
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) =>
                Math.max(
                  0,
                  Math.min(
                    filtered.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (filtered[active]) select(filtered[active].code);
            }
          }}
        />
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          className="max-h-60 overflow-y-auto pt-1"
        >
          {filtered.map(({ code, name }, index) => (
            <button
              key={code}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={code === value}
              tabIndex={-1}
              onClick={() => select(code)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                active === index && "bg-accent",
              )}
            >
              <Check
                className={cn(
                  "h-4 w-4 shrink-0",
                  code !== value && "invisible",
                )}
              />
              <span className="min-w-0 flex-1">{name}</span>
              <span className="text-muted-foreground">{code}</span>
            </button>
          ))}
          {!filtered.length && (
            <p className="p-3 text-sm text-muted-foreground">
              {russian ? "Валюта не найдена" : "No currencies found"}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
